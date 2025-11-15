package com.soteria.backend;

import com.algorand.algosdk.account.Account;
import com.algorand.algosdk.transaction.SignedTransaction;
import com.algorand.algosdk.transaction.Transaction;
import com.algorand.algosdk.v2.client.common.AlgodClient;
import com.algorand.algosdk.v2.client.common.Response;
import com.algorand.algosdk.v2.client.model.PendingTransactionResponse;
import com.algorand.algosdk.v2.client.model.TransactionParametersResponse;
import com.google.gson.Gson;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.logging.Logger;

/**
 * Handles logging guest access events to the blockchain
 * This creates an immutable audit trail of all door access events
 */
public class AccessLogger {
    
    private static final Logger LOGGER = Logger.getLogger(AccessLogger.class.getName());
    private final SoteriaConfig config;
    private final AlgodClient algodClient;
    private final Account smartLockAccount;
    private final Gson gson;
    
    /**
     * Initialize the access logger with smart lock credentials
     * 
     * @param config Application configuration
     * @param algodClient Algorand client for submitting transactions
     * @param smartLockMnemonic 25-word mnemonic for the smart lock's wallet
     */
    public AccessLogger(SoteriaConfig config, AlgodClient algodClient, String smartLockMnemonic) {
        this.config = config;
        this.algodClient = algodClient;
        this.gson = new Gson();
        
        try {
            // Restore smart lock account from mnemonic
            this.smartLockAccount = new Account(smartLockMnemonic);
            LOGGER.info("Access Logger initialized with smart lock address: " + smartLockAccount.getAddress());
        } catch (Exception e) {
            throw new RuntimeException("Failed to initialize smart lock account: " + e.getMessage(), e);
        }
    }
    
    /**
     * Log a successful guest access event to the blockchain
     * Creates a 0 ALGO transaction with access details in the note field
     * 
     * @param keyId The key ID used for access
     * @param keyName Name/description of the guest
     * @param ownerAddress Address of the property owner (transaction recipient)
     * @return Transaction ID of the logged access event
     */
    public String logAccessGranted(String keyId, String keyName, String ownerAddress) {
        LOGGER.info("=".repeat(60));
        LOGGER.info("LOGGING GUEST ACCESS TO BLOCKCHAIN");
        LOGGER.info("=".repeat(60));
        LOGGER.info("Guest: " + keyName);
        LOGGER.info("Key ID: " + keyId);
        LOGGER.info("Owner: " + ownerAddress);
        
        try {
            // Get suggested transaction parameters
            Response<TransactionParametersResponse> paramsResponse = algodClient.TransactionParams().execute();
            TransactionParametersResponse params = paramsResponse.body();
            
            // Create access log data
            Map<String, Object> accessData = new HashMap<>();
            accessData.put("app_id", config.getAppId());  // Now stores Long
            accessData.put("action", "guest_access");
            accessData.put("keyId", keyId);
            accessData.put("keyName", keyName);
            accessData.put("timestamp", Instant.now().toString());
            accessData.put("access_type", "granted");
            
            String noteJson = gson.toJson(accessData);
            byte[] note = noteJson.getBytes(StandardCharsets.UTF_8);
            
            LOGGER.info("Access log note: " + noteJson);
            
            // Create transaction (0 ALGO from smart lock to owner)
            Transaction txn = Transaction.PaymentTransactionBuilder()
                .sender(smartLockAccount.getAddress())
                .receiver(ownerAddress)
                .amount(0)
                .note(note)
                .suggestedParams(params)
                .build();
            
            // Sign transaction with smart lock's private key
            SignedTransaction signedTxn = smartLockAccount.signTransaction(txn);
            
            // Submit to blockchain
            byte[] encodedTxn = com.algorand.algosdk.util.Encoder.encodeToMsgPack(signedTxn);
            Response<com.algorand.algosdk.v2.client.model.PostTransactionsResponse> submitResponse = 
                algodClient.RawTransaction().rawtxn(encodedTxn).execute();
            
            String txId = submitResponse.body().txId;
            LOGGER.info("✓ Access logged to blockchain");
            LOGGER.info("Transaction ID: " + txId);
            
            // Wait for confirmation
            waitForConfirmation(txId);
            
            LOGGER.info("✓ Transaction confirmed");
            LOGGER.info("=".repeat(60));
            
            return txId;
            
        } catch (Exception e) {
            LOGGER.severe("✗ Failed to log access: " + e.getMessage());
            e.printStackTrace();
            // Don't throw - logging failure shouldn't block access
            return null;
        }
    }
    
    /**
     * Log a denied access attempt to the blockchain
     * Useful for security auditing
     * 
     * @param keyId The key ID attempted
     * @param keyName Name of the guest
     * @param ownerAddress Owner address
     * @param denialReason Why access was denied
     * @return Transaction ID or null if failed
     */
    public String logAccessDenied(String keyId, String keyName, String ownerAddress, String denialReason) {
        LOGGER.info("=".repeat(60));
        LOGGER.info("LOGGING ACCESS DENIAL TO BLOCKCHAIN");
        LOGGER.info("=".repeat(60));
        LOGGER.info("Guest: " + keyName);
        LOGGER.info("Reason: " + denialReason);
        
        try {
            Response<TransactionParametersResponse> paramsResponse = algodClient.TransactionParams().execute();
            TransactionParametersResponse params = paramsResponse.body();
            
            Map<String, Object> accessData = new HashMap<>();
            accessData.put("app_id", config.getAppId());  // Now stores Long
            accessData.put("action", "guest_access_denied");
            accessData.put("keyId", keyId);
            accessData.put("keyName", keyName);
            accessData.put("timestamp", Instant.now().toString());
            accessData.put("access_type", "denied");
            accessData.put("reason", denialReason);
            
            String noteJson = gson.toJson(accessData);
            byte[] note = noteJson.getBytes(StandardCharsets.UTF_8);
            
            Transaction txn = Transaction.PaymentTransactionBuilder()
                .sender(smartLockAccount.getAddress())
                .receiver(ownerAddress)
                .amount(0)
                .note(note)
                .suggestedParams(params)
                .build();
            
            SignedTransaction signedTxn = smartLockAccount.signTransaction(txn);
            byte[] encodedTxn = com.algorand.algosdk.util.Encoder.encodeToMsgPack(signedTxn);
            
            Response<com.algorand.algosdk.v2.client.model.PostTransactionsResponse> submitResponse = 
                algodClient.RawTransaction().rawtxn(encodedTxn).execute();
            
            String txId = submitResponse.body().txId;
            LOGGER.info("✓ Denial logged to blockchain: " + txId);
            LOGGER.info("=".repeat(60));
            
            return txId;
            
        } catch (Exception e) {
            LOGGER.severe("✗ Failed to log denial: " + e.getMessage());
            return null;
        }
    }
    
    /**
     * Wait for transaction confirmation
     */
    private void waitForConfirmation(String txId) throws Exception {
        int maxAttempts = 10;
        for (int i = 0; i < maxAttempts; i++) {
            try {
                Response<PendingTransactionResponse> response = 
                    algodClient.PendingTransactionInformation(txId).execute();
                
                if (response.body().confirmedRound != null && response.body().confirmedRound > 0) {
                    LOGGER.info("Transaction confirmed in round: " + response.body().confirmedRound);
                    return;
                }
            } catch (Exception e) {
                // Continue waiting
            }
            
            Thread.sleep(1000);
        }
        
        throw new Exception("Transaction not confirmed after " + maxAttempts + " seconds");
    }
    
    /**
     * Get the smart lock's wallet address
     * Used to identify transactions created by the smart lock
     */
    public String getSmartLockAddress() {
        return smartLockAccount.getAddress().toString();
    }
}