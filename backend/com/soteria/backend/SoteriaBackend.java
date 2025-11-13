package com.soteria.backend;

import com.algorand.algosdk.abi.Method;
import com.algorand.algosdk.abi.StringType;
import com.algorand.algosdk.v2.client.model.DryrunRequest;
import com.algorand.algosdk.v2.client.model.DryrunResponse;
import com.algorand.algosdk.v2.client.model.DryrunTxnResult;
import com.algorand.algosdk.v2.client.model.Application;
import com.algorand.algosdk.v2.client.model.ApplicationCallTransaction;
import com.algorand.algosdk.v2.client.model.Account;
import com.algorand.algosdk.v2.client.common.IndexerClient;
import com.algorand.algosdk.v2.client.common.AlgodClient;
import com.algorand.algosdk.v2.client.common.Response;
import com.algorand.algosdk.v2.client.model.TransactionResponse;
import com.algorand.algosdk.v2.client.model.TransactionsResponse;
import com.algorand.algosdk.crypto.Address;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Base64;
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
    LOGGER.info("ACCESS VERIFICATION REQUEST (CONTRACT)");
    LOGGER.info("========================================");
    
    long startTime = System.currentTimeMillis();
    
    try {
        // Step 1: Parse & Sanitize QR Code
        LOGGER.info("Step 1: Parse & Sanitize QR Code");
        QRCodeData qrData = parseAndSanitize(qrCodeData);
        if (qrData == null) {
            return VerificationResult.deny("Invalid QR code format");
        }
        LOGGER.info("✓ QR code parsed successfully");
        LOGGER.info("  Key ID: " + qrData.keyId);
        LOGGER.info("  Key Name: " + qrData.keyName);

        // Step 2: Verify Access via Smart Contract (Dry-run)
        LOGGER.info("\nStep 2: On-Chain Verification (Contract Call)");
        
        // 1. Define the ABI method selector
        Method method = new Method("verify_access(string)string");
        
        // 2. Prepare arguments
        List<Object> methodArgs = new ArrayList<>();
        methodArgs.add(qrData.keyId);

        // 3. Create a dummy ApplicationCallTransaction
        ApplicationCallTransaction appCallTxn = new ApplicationCallTransaction();
        appCallTxn.appId = config.getAppId();
        appCallTxn.onComplete = "noop";
        appCallTxn.appArgs = Method.encodeABIArgs(method, methodArgs);
        
        // We need a sender, even for a dry-run. Use the smart lock's address.
        appCallTxn.sender = accessLogger.getSmartLockAddress();
        
        // 4. Create Dryrun Request
        DryrunRequest drr = new DryrunRequest();
        drr.txns = new ArrayList<>();
        drr.txns.add(appCallTxn);
        drr.apps = new ArrayList<>();
        drr.apps.add(new Application().id(config.getAppId()));
        drr.accounts = new ArrayList<>();
        drr.accounts.add(new Account().address(accessLogger.getSmartLockAddress()));
        drr.latestTimestamp = Instant.now().getEpochSecond(); // Use current time
        
        // 5. Execute Dryrun
        Response<DryrunResponse> dryrunResponse = algodClient.dryrun(drr).execute();
        
        if (!dryrunResponse.isSuccessful()) {
            throw new Exception("Dryrun failed: " + dryrunResponse.message());
        }

        DryrunTxnResult result = dryrunResponse.body().txns.get(0);
        
        // 6. Check the result string
        String contractResult = "";
        if (result.appCallReturnValue != null && !result.appCallReturnValue.isEmpty()) {
            // Decode the ABI string result
            contractResult = (String) new StringType().decode(Base64.getDecoder().decode(result.appCallReturnValue));
        } else {
             // Handle potential failure where no value is returned
             LOGGER.warning("Contract did not return a value. Logs: " + result.appCallMessages);
             return VerificationResult.deny("Contract verification failed");
        }

        LOGGER.info("  Contract result: " + contractResult);

        // 7. Grant or Deny based on the contract's response
        if (!"GRANTED".equals(contractResult)) {
            accessLogger.logAccessDenied(qrData.keyId, qrData.keyName, "UNKNOWN", contractResult);
            return VerificationResult.deny(contractResult);
        }
        
        // All checks passed
        long duration = System.currentTimeMillis() - startTime;
        LOGGER.info("\n========================================");
        LOGGER.info("✓✓✓ ACCESS GRANTED ✓✓✓");
        LOGGER.info("All verification checks passed by contract");
        LOGGER.info("Verification time: " + duration + "ms");
        LOGGER.info("========================================");
        
        // Grant physical access
        grantAccess(qrData);
        
        // Log successful access to blockchain
        LOGGER.info("\nLogging access event to blockchain...");
        // Note: We pass "UNKNOWN" for owner as the contract doesn't return it
        String accessLogTxId = accessLogger.logAccessGranted(qrData.keyId, qrData.keyName, "UNKNOWN");
        if (accessLogTxId != null) {
            LOGGER.info("✓ Access logged to blockchain: " + accessLogTxId);
        } else {
            LOGGER.warning("⚠ Failed to log access (but door unlocked anyway)");
        }
        
        // Create details maps for VerificationResult
        Map<String, Object> qrDataMap = new HashMap<>();
        qrDataMap.put("keyId", qrData.keyId);
        qrDataMap.put("keyName", qrData.keyName);
        qrDataMap.put("recipient", "N/A (Handled by Contract)");
        qrDataMap.put("accessLogTxId", accessLogTxId);
        
        Map<String, Object> txDataMap = new HashMap<>();
        txDataMap.put("owner", "N/A (Contract Owner)");
        txDataMap.put("confirmedRound", result.logicSigMessages); 
        
        return VerificationResult.grant("All verification checks passed", qrDataMap, txDataMap);
        
    } catch (Exception e) {
        LOGGER.severe("Verification error: " + e.getMessage());
        e.printStackTrace();
        return VerificationResult.deny("System error during verification: " + e.getMessage());
    }
}
private QRCodeData parseAndSanitize(String qrCodeData) {
    try {
        JsonObject json = JsonParser.parseString(qrCodeData).getAsJsonObject();
        
        LOGGER.info("  Raw QR JSON: " + qrCodeData);
        
        // Validate required fields
        if (!json.has("keyId") || !json.has("appId")) {
            LOGGER.warning("✗ Missing required fields in QR code (keyId, appId)");
            return null;
        }
        
        // Validate app ID matches
        // Note: The config.getAppId() must now be the *numeric* App ID.
        Long configAppId = config.getAppId();
        Long qrAppId = json.get("appId").getAsLong();
        
        if (!configAppId.equals(qrAppId)) {
            LOGGER.warning("✗ App ID mismatch. Expected: " + configAppId + ", Got: " + qrAppId);
            return null;
        }
        
        // Extract data
        QRCodeData data = new QRCodeData();
        data.keyId = json.get("keyId").getAsString();
        data.keyName = json.has("keyName") ? json.get("keyName").getAsString() : "Unknown Guest";
        data.appId = qrAppId.toString(); // Store as string for consistency
        
        // No need to validate keyId format, it's now a contract-defined string
        
        return data;
        
    } catch (Exception e) {
        LOGGER.warning("✗ Failed to parse QR code: " + e.getMessage());
        e.printStackTrace();
        return null;
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