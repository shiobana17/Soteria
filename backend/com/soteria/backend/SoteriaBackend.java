package com.soteria.backend;

import com.algorand.algosdk.v2.client.common.IndexerClient;
import com.algorand.algosdk.v2.client.common.AlgodClient;
import com.algorand.algosdk.v2.client.common.Response;
import com.algorand.algosdk.v2.client.model.TransactionResponse;
import com.algorand.algosdk.v2.client.model.TransactionsResponse;
import com.algorand.algosdk.crypto.Address;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.HashMap;
import java.util.Map;
import java.util.logging.Logger;

public class SoteriaBackend {
    
    private static final Logger LOGGER = Logger.getLogger(SoteriaBackend.class.getName());
    private final SoteriaConfig config;
    private final IndexerClient indexerClient;
    @SuppressWarnings("unused")
    private final AlgodClient algodClient;  // Reserved for future transaction submission
    @SuppressWarnings("unused")
    private final Gson gson;  // Reserved for future JSON operations
    private final LockController lockController;
    private final AccessLogger accessLogger;  
    

    public SoteriaBackend(SoteriaConfig config, String smartLockMnemonic) {
    this.config = config;
    
    // For sandbox development
    String host = "localhost";
    int indexerPort = 8980;
    int algodPort = 4001;
    String token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    
    this.indexerClient = new IndexerClient(host, indexerPort, token);
    this.algodClient = new AlgodClient(host, algodPort, token);
    this.gson = new Gson();
    this.lockController = new LockController(config.getLockGpioPin());
    this.accessLogger = new AccessLogger(config, algodClient, smartLockMnemonic);
    
    LOGGER.info("Soteria Backend v" + config.getAppVersion() + " initialized");
    LOGGER.info("App ID: " + config.getAppId());
    LOGGER.info("Smart Lock Address: " + accessLogger.getSmartLockAddress());
    LOGGER.info("Network: Sandbox (localhost)");
}

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
        LOGGER.info("  Key Name: " + qrData.keyName);
        
        // Step 2: Authenticity Check
        LOGGER.info("\nStep 2: Authenticity Check (On-Chain Lookup)");
        TransactionData txData = verifyAuthenticity(qrData);
        if (txData == null) {
            accessLogger.logAccessDenied(qrData.keyId, qrData.keyName, "UNKNOWN", "Transaction not found");
            return VerificationResult.deny("Transaction not found on blockchain");
        }
        LOGGER.info("✓ Transaction found on-chain");
        LOGGER.info("  Confirmed in round: " + txData.confirmedRound);
        LOGGER.info("  Owner: " + txData.owner);
        LOGGER.info("  Recipient: " + txData.recipient);
        
        // Step 3: Revocation Check
        LOGGER.info("\nStep 3: Revocation Check (Search Owner's History)");
        if (isKeyRevoked(qrData.keyId, txData.owner)) {
            accessLogger.logAccessDenied(qrData.keyId, qrData.keyName, txData.owner, "Key revoked by owner");
            return VerificationResult.deny("Key has been revoked by owner");
        }
        LOGGER.info("✓ No revocation found - key is active");
        
        // Step 4: Time-Lock Check
        LOGGER.info("\nStep 4: Time-Lock Check (Validity Window)");
        VerificationResult timeLockResult = verifyTimeLock(qrData);
        if (!timeLockResult.isGranted()) {
            accessLogger.logAccessDenied(qrData.keyId, qrData.keyName, txData.owner, timeLockResult.getReason());
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
        
        // Log successful access to blockchain
        LOGGER.info("\nLogging access event to blockchain...");
        String accessLogTxId = accessLogger.logAccessGranted(qrData.keyId, qrData.keyName, txData.owner);
        if (accessLogTxId != null) {
            LOGGER.info("✓ Access logged to blockchain: " + accessLogTxId);
        } else {
            LOGGER.warning("⚠ Failed to log access (but door unlocked anyway)");
        }
        
        // Create details maps for VerificationResult
        Map<String, Object> qrDataMap = new HashMap<>();
        qrDataMap.put("keyId", qrData.keyId);
        qrDataMap.put("keyName", qrData.keyName);
        qrDataMap.put("recipient", txData.recipient);
        qrDataMap.put("accessLogTxId", accessLogTxId);
        
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
            
            LOGGER.info("  Raw QR JSON: " + qrCodeData);
            
            // Validate required fields
            if (!json.has("keyId") || !json.has("validFrom") || 
                !json.has("validUntil") || !json.has("appId")) {
                LOGGER.warning("✗ Missing required fields in QR code");
                return null;
            }
            
            // Validate app ID matches
            String appId = json.get("appId").getAsString();
            if (!config.getAppId().equals(appId)) {
                LOGGER.warning("✗ App ID mismatch. Expected: " + config.getAppId() + ", Got: " + appId);
                return null;
            }
            
            // Extract data
            QRCodeData data = new QRCodeData();
            data.keyId = json.get("keyId").getAsString();
            data.validFrom = json.get("validFrom").getAsString();
            data.validUntil = json.get("validUntil").getAsString();
            data.keyName = json.has("keyName") ? json.get("keyName").getAsString() : "Unknown Guest";
            data.appId = appId;
            
            // Validate keyId looks like a transaction ID (52 chars, uppercase alphanumeric)
            if (data.keyId.length() != 52 || !data.keyId.matches("[A-Z0-9]+")) {
                LOGGER.warning("✗ Invalid transaction ID format: " + data.keyId);
                return null;
            }
            
            return data;
            
        } catch (Exception e) {
            LOGGER.warning("✗ Failed to parse QR code: " + e.getMessage());
            e.printStackTrace();
            return null;
        }
    }
    
    /**
     * Step 2: Authenticity Check
     * Verifies the transaction exists on-chain and extracts recipient from blockchain
     */
    private TransactionData verifyAuthenticity(QRCodeData qrData) {
        try {
            // Look up transaction by ID - v2 API
            Response<TransactionResponse> response = indexerClient
                .lookupTransaction(qrData.keyId)
                .execute();
            
            if (response.body() == null || response.body().transaction == null) {
                LOGGER.warning("✗ Transaction not found: " + qrData.keyId);
                return null;
            }
            
            com.algorand.algosdk.v2.client.model.Transaction tx = response.body().transaction;
            
            // Decode and parse the note field
            if (tx.note == null || tx.note.length == 0) {
                LOGGER.warning("✗ Transaction has no note data");
                return null;
            }
            
            String noteJson = new String(tx.note, StandardCharsets.UTF_8);
            LOGGER.info("  Transaction note: " + noteJson);
            
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
            
            // Extract details
            if (!noteData.has("details")) {
                LOGGER.warning("✗ Transaction missing details");
                return null;
            }
            
            JsonObject details = noteData.getAsJsonObject("details");
            
            // Extract recipient from blockchain
            if (!details.has("recipient")) {
                LOGGER.warning("✗ Transaction missing recipient in details");
                return null;
            }
            
            String recipient = details.get("recipient").getAsString();
            
            // Validate recipient address format
            if (!isValidAlgorandAddress(recipient)) {
                LOGGER.warning("✗ Invalid recipient address format: " + recipient);
                return null;
            }
            
            // Extract transaction data
            TransactionData txData = new TransactionData();
            txData.txId = qrData.keyId;
            txData.owner = tx.sender;
            txData.recipient = recipient;
            txData.confirmedRound = tx.confirmedRound;
            txData.noteData = noteData;
            
            return txData;
            
        } catch (Exception e) {
            LOGGER.severe("✗ Error during authenticity check: " + e.getMessage());
            e.printStackTrace();
            return null;
        }
    }
    
    /**
     * Step 3: Revocation Check
     * Searches the owner's transaction history for a revocation
     */
    private boolean isKeyRevoked(String keyId, String ownerAddress) {
        try {
            // Convert string to Address object
            Address ownerAddr = new Address(ownerAddress);
            
            // Search owner's transactions - v2 API
            Response<TransactionsResponse> response = indexerClient
                .searchForTransactions()
                .address(ownerAddr)
                .limit(1000L)
                .execute();
            
            if (response.body() == null || response.body().transactions == null) {
                LOGGER.warning("⚠ Could not fetch owner's transaction history");
                return false; // Fail open if we can't check
            }
            
            for (com.algorand.algosdk.v2.client.model.Transaction tx : response.body().transactions) {
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
            e.printStackTrace();
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
        String validFrom;
        String validUntil;
        String keyName;
        @SuppressWarnings("unused")
        String appId;  // Reserved for additional validation
    }
    
    /**
     * Inner class to hold transaction data from blockchain
     */
    private static class TransactionData {
        @SuppressWarnings("unused")
        String txId;  // Reserved for logging
        String owner;
        String recipient;
        Long confirmedRound;
        @SuppressWarnings("unused")
        JsonObject noteData;  // Reserved for advanced validation
    }
}