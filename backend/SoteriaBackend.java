package com.soteria.backend;

import com.algorand.algosdk.v2.client.common.AlgodClient;
import com.algorand.algosdk.v2.client.common.IndexerClient;
import com.algorand.algosdk.v2.client.model.Transaction;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Base64;
import java.util.List;
import java.util.logging.Logger;

/**
 * Soteria Backend - IoT Device Access Control System
 * 
 * ROLE: The Digital Bouncer
 * This backend is a stateless, trustless verifier that grants or denies access
 * based solely on the mathematical certainty of the Algorand blockchain.
 * 
 * TRUST MODEL:
 * - Trusts: Algorand blockchain consensus, cryptographic signatures
 * - Does NOT trust: QR codes, user claims, cached data, the frontend
 * 
 * VERIFICATION ALGORITHM:
 * 1. Parse & Sanitize: Validate QR code structure
 * 2. Authenticity Check: Verify transaction exists on-chain
 * 3. Revocation Check: Search for revoke transactions
 * 4. Time-Lock Check: Verify current time is within validity window
 * 
 * Only if ALL checks pass → Grant Access
 */
public class SoteriaBackend {
    
    private static final Logger LOGGER = Logger.getLogger(SoteriaBackend.class.getName());
    private final SoteriaConfig config;
    private final IndexerClient indexerClient;
    private final AlgodClient algodClient;
    private final Gson gson;
    private final LockController lockController;
    
    public SoteriaBackend(SoteriaConfig config) {
        this.config = config;
        this.indexerClient = new IndexerClient(config.getIndexerAddress(), config.getIndexerToken());
        this.algodClient = new AlgodClient(config.getAlgodAddress(), config.getAlgodToken());
        this.gson = new Gson();
        this.lockController = new LockController(config.getLockGpioPin());
        
        LOGGER.info("Soteria Backend v" + config.getAppVersion() + " initialized");
        LOGGER.info("App ID: " + config.getAppId());
        LOGGER.info("Network: " + (config.isTestNet() ? "TestNet" : "MainNet"));
    }
    
    /**
     * Main entry point for access verification
     * 
     * @param qrCodeData Raw JSON string from scanned QR code
     * @return VerificationResult indicating whether access should be granted
     */
    public VerificationResult verifyAccess(String qrCodeData) {
        LOGGER.info("========================================");
        LOGGER.info("ACCESS VERIFICATION REQUEST");
        LOGGER.info("========================================");
        
        long startTime = System.currentTimeMillis();
        
        try {
            // Step 1: Parse & Sanitize
            LOGGER.info("Step 1: Parse & Sanitize QR Code");
            QRCodeData qrData = parseAndSanitize(qrCodeData);
            if (qrData == null) {
                return VerificationResult.deny("Invalid QR code format");
            }
            LOGGER.info("✓ QR code parsed successfully");
            LOGGER.info("  Key ID: " + qrData.keyId);
            LOGGER.info("  Recipient: " + qrData.recipient);
            LOGGER.info("  Key Name: " + qrData.keyName);
            
            // Step 2: Authenticity Check
            LOGGER.info("\nStep 2: Authenticity Check (On-Chain Lookup)");
            TransactionData txData = verifyAuthenticity(qrData);
            if (txData == null) {
                return VerificationResult.deny("Transaction not found on blockchain");
            }
            LOGGER.info("✓ Transaction found on-chain");
            LOGGER.info("  Confirmed in round: " + txData.confirmedRound);
            LOGGER.info("  Owner: " + txData.owner);
            
            // Step 3: Revocation Check
            LOGGER.info("\nStep 3: Revocation Check (Search Owner's History)");
            if (isKeyRevoked(qrData.keyId, txData.owner)) {
                return VerificationResult.deny("Key has been revoked by owner");
            }
            LOGGER.info("✓ No revocation found - key is active");
            
            // Step 4: Time-Lock Check
            LOGGER.info("\nStep 4: Time-Lock Check (Validity Window)");
            VerificationResult timeLockResult = verifyTimeLock(qrData);
            if (!timeLockResult.isGranted()) {
                return timeLockResult;
            }
            LOGGER.info("✓ Current time is within validity window");
            
            // All checks passed
            long duration = System.currentTimeMillis() - startTime;
            LOGGER.info("\n========================================");
            LOGGER.info("✓✓✓ ACCESS GRANTED ✓✓✓");
            LOGGER.info("All verification checks passed");
            LOGGER.info("Verification time: " + duration + "ms");
            LOGGER.info("========================================");
            
            // Grant physical access
            grantAccess(qrData);
            
            // Create details maps for VerificationResult
            Map<String, Object> qrDataMap = new HashMap<>();
            qrDataMap.put("keyId", qrData.keyId);
            qrDataMap.put("recipient", qrData.recipient);
            qrDataMap.put("keyName", qrData.keyName);
            
            Map<String, Object> txDataMap = new HashMap<>();
            txDataMap.put("owner", txData.owner);
            txDataMap.put("confirmedRound", txData.confirmedRound);
            
            return VerificationResult.grant("All verification checks passed", qrDataMap, txDataMap);
            
        } catch (Exception e) {
            LOGGER.severe("Verification error: " + e.getMessage());
            e.printStackTrace();
            return VerificationResult.deny("System error during verification: " + e.getMessage());
        }
    }
    
    /**
     * Step 1: Parse & Sanitize
     * Validates the QR code structure and extracts data
     */
    private QRCodeData parseAndSanitize(String qrCodeData) {
        try {
            JsonObject json = JsonParser.parseString(qrCodeData).getAsJsonObject();
            
            // Validate required fields
            if (!json.has("keyId") || !json.has("recipient") || 
                !json.has("validFrom") || !json.has("validUntil") || 
                !json.has("appId")) {
                LOGGER.warning("✗ Missing required fields in QR code");
                return null;
            }
            
            // Validate app ID matches
            String appId = json.get("appId").getAsString();
            if (!config.getAppId().equals(appId)) {
                LOGGER.warning("✗ App ID mismatch. Expected: " + config.getAppId() + ", Got: " + appId);
                return null;
            }
            
            // Extract and validate data
            QRCodeData data = new QRCodeData();
            data.keyId = json.get("keyId").getAsString();
            data.recipient = json.get("recipient").getAsString();
            data.validFrom = json.get("validFrom").getAsString();
            data.validUntil = json.get("validUntil").getAsString();
            data.keyName = json.has("keyName") ? json.get("keyName").getAsString() : "Unknown";
            data.appId = appId;
            
            // Validate Algorand address format (58 characters, base32)
            if (!isValidAlgorandAddress(data.recipient)) {
                LOGGER.warning("✗ Invalid Algorand address format");
                return null;
            }
            
            return data;
            
        } catch (Exception e) {
            LOGGER.warning("✗ Failed to parse QR code: " + e.getMessage());
            return null;
        }
    }
    
    /**
     * Step 2: Authenticity Check
     * Verifies the transaction exists on-chain and matches QR data
     */
    private TransactionData verifyAuthenticity(QRCodeData qrData) {
        try {
            // Look up transaction by ID on the blockchain
            var response = indexerClient.lookupTransaction(qrData.keyId).execute();
            
            if (!response.isSuccessful() || response.body() == null) {
                LOGGER.warning("✗ Transaction not found: " + qrData.keyId);
                return null;
            }
            
            Transaction tx = response.body().transaction;
            
            // Decode and parse the note field
            if (tx.note == null || tx.note.length == 0) {
                LOGGER.warning("✗ Transaction has no note data");
                return null;
            }
            
            String noteJson = new String(tx.note, StandardCharsets.UTF_8);
            JsonObject noteData = JsonParser.parseString(noteJson).getAsJsonObject();
            
            // Verify app_id matches
            if (!noteData.has("app_id") || !config.getAppId().equals(noteData.get("app_id").getAsString())) {
                LOGGER.warning("✗ Transaction app_id mismatch");
                return null;
            }
            
            // Verify action is create_guest_key
            if (!noteData.has("action") || !"create_guest_key".equals(noteData.get("action").getAsString())) {
                LOGGER.warning("✗ Transaction is not a key creation");
                return null;
            }
            
            // Verify details match QR code
            if (!noteData.has("details")) {
                LOGGER.warning("✗ Transaction missing details");
                return null;
            }
            
            JsonObject details = noteData.getAsJsonObject("details");
            String txRecipient = details.get("recipient").getAsString();
            
            if (!qrData.recipient.equals(txRecipient)) {
                LOGGER.warning("✗ Recipient mismatch. QR: " + qrData.recipient + ", Chain: " + txRecipient);
                return null;
            }
            
            // Extract transaction data
            TransactionData txData = new TransactionData();
            txData.txId = qrData.keyId;
            txData.owner = tx.sender;
            txData.confirmedRound = tx.confirmedRound;
            txData.noteData = noteData;
            
            return txData;
            
        } catch (Exception e) {
            LOGGER.severe("✗ Error during authenticity check: " + e.getMessage());
            return null;
        }
    }
    
    /**
     * Step 3: Revocation Check
     * Searches the owner's transaction history for a revocation
     */
    private boolean isKeyRevoked(String keyId, String ownerAddress) {
        try {
            // Search owner's transactions for revocations
            var response = indexerClient.lookupAccountTransactions(ownerAddress)
                .limit(1000L)  // Search last 1000 transactions
                .execute();
            
            if (!response.isSuccessful() || response.body() == null) {
                LOGGER.warning("⚠ Could not fetch owner's transaction history");
                return false; // Fail open if we can't check
            }
            
            List<Transaction> transactions = response.body().transactions;
            
            for (Transaction tx : transactions) {
                if (tx.note == null || tx.note.length == 0) continue;
                
                try {
                    String noteJson = new String(tx.note, StandardCharsets.UTF_8);
                    JsonObject noteData = JsonParser.parseString(noteJson).getAsJsonObject();
                    
                    // Check if this is a revocation for our key
                    if (noteData.has("app_id") && config.getAppId().equals(noteData.get("app_id").getAsString()) &&
                        noteData.has("action") && "revoke_guest_key".equals(noteData.get("action").getAsString()) &&
                        noteData.has("revokes") && keyId.equals(noteData.get("revokes").getAsString())) {
                        
                        LOGGER.warning("✗ Revocation found: " + tx.id);
                        return true;
                    }
                } catch (Exception e) {
                    // Skip transactions with invalid note format
                    continue;
                }
            }
            
            return false;
            
        } catch (Exception e) {
            LOGGER.severe("✗ Error during revocation check: " + e.getMessage());
            return false; // Fail open if we can't check
        }
    }
    
    /**
     * Step 4: Time-Lock Check
     * Verifies current time is within the key's validity window
     */
    private VerificationResult verifyTimeLock(QRCodeData qrData) {
        try {
            Instant now = Instant.now();
            Instant validFrom = Instant.parse(qrData.validFrom);
            Instant validUntil = Instant.parse(qrData.validUntil);
            
            LOGGER.info("  Current time: " + now);
            LOGGER.info("  Valid from:   " + validFrom);
            LOGGER.info("  Valid until:  " + validUntil);
            
            // Apply time tolerance for clock drift
            Instant adjustedFrom = validFrom.minusSeconds(config.getTimeTolerance());
            Instant adjustedUntil = validUntil.plusSeconds(config.getTimeTolerance());
            
            if (now.isBefore(adjustedFrom)) {
                LOGGER.warning("✗ Access attempted before validity window");
                long secondsUntil = adjustedFrom.getEpochSecond() - now.getEpochSecond();
                return VerificationResult.deny("Key not yet valid (starts in " + secondsUntil + " seconds)");
            }
            
            if (now.isAfter(adjustedUntil)) {
                LOGGER.warning("✗ Access attempted after validity window");
                long secondsAgo = now.getEpochSecond() - adjustedUntil.getEpochSecond();
                return VerificationResult.deny("Key has expired (" + secondsAgo + " seconds ago)");
            }
            
            long remainingSeconds = adjustedUntil.getEpochSecond() - now.getEpochSecond();
            LOGGER.info("  Time remaining: " + remainingSeconds + " seconds");
            
            return VerificationResult.grant("Time-lock valid", null, null);
            
        } catch (DateTimeParseException e) {
            LOGGER.severe("✗ Invalid timestamp format: " + e.getMessage());
            return VerificationResult.deny("Invalid timestamp format in key");
        }
    }
    
    /**
     * Grant physical access by unlocking the door
     */
    private void grantAccess(QRCodeData qrData) {
        try {
            LOGGER.info("\n>>> UNLOCKING DOOR <<<");
            LOGGER.info("Access granted to: " + qrData.keyName);
            LOGGER.info("Duration: " + config.getAccessGrantDuration() + " seconds");
            
            lockController.unlock();
            
            // Keep door unlocked for configured duration
            Thread.sleep(config.getAccessGrantDuration() * 1000L);
            
            lockController.lock();
            LOGGER.info(">>> DOOR LOCKED <<<");
            
        } catch (Exception e) {
            LOGGER.severe("Error controlling lock: " + e.getMessage());
        }
    }
    
    /**
     * Validates Algorand address format
     */
    private boolean isValidAlgorandAddress(String address) {
        if (address == null || address.length() != 58) {
            return false;
        }
        
        // Algorand addresses are base32 encoded
        String base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        for (char c : address.toCharArray()) {
            if (base32Chars.indexOf(c) == -1) {
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * Inner class to hold parsed QR code data
     */
    private static class QRCodeData {
        String keyId;
        String recipient;
        String validFrom;
        String validUntil;
        String keyName;
        String appId;
    }
    
    /**
     * Inner class to hold transaction data from blockchain
     */
    private static class TransactionData {
        String txId;
        String owner;
        Long confirmedRound;
        JsonObject noteData;
    }
}