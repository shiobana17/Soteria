package com.soteria.backend;

import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;
import java.util.logging.Logger;

public class SoteriaConfig {
    
    private static final Logger LOGGER = Logger.getLogger(SoteriaConfig.class.getName());
    
    // Application metadata
    private final String appVersion = "1.0.0";
    
    // Hardware settings
    private final int lockGpioPin = 4; 
    private final long timeTolerance = 60L; 
    private final long accessGrantDuration = 10L;
    
    // Algorand configuration (loaded from properties file)
    private Long appId;
    private String appAddress;
    private String algodAddress;
    private String indexerAddress;
    private String network;
    
    public SoteriaConfig() {
        loadAlgorandConfig();
    }
    
    /**
     * Load Algorand configuration from properties file
     */
    private void loadAlgorandConfig() {
        Properties props = new Properties();
        
        // Try to load from resources folder
        try (InputStream input = getClass().getClassLoader().getResourceAsStream("algorand.properties")) {
            if (input != null) {
                props.load(input);
                LOGGER.info("Loaded config from resources/algorand.properties");
            } else {
                // Fallback: try loading from file system
                try (FileInputStream fileInput = new FileInputStream("backend/resources/algorand.properties")) {
                    props.load(fileInput);
                    LOGGER.info("Loaded config from backend/resources/algorand.properties");
                }
            }
        } catch (IOException e) {
            LOGGER.severe("Could not load algorand.properties: " + e.getMessage());
            LOGGER.severe("Please run deploy.py to generate the configuration file!");
            throw new RuntimeException("Configuration file not found. Please deploy the contract first.", e);
        }
        
        // Parse configuration
        try {
            this.appId = Long.parseLong(props.getProperty("algorand.app.id", "0"));
            this.appAddress = props.getProperty("algorand.app.address", "");
            this.algodAddress = props.getProperty("algorand.algod.address", "https://testnet-api.algonode.cloud");
            this.indexerAddress = props.getProperty("algorand.indexer.address", "https://testnet-idx.algonode.cloud");
            this.network = props.getProperty("algorand.network", "testnet");
            
            if (this.appId == 0) {
                throw new RuntimeException("Invalid App ID. Please deploy the contract first.");
            }
            
            LOGGER.info("Configuration loaded successfully:");
            LOGGER.info("  App ID: " + this.appId);
            LOGGER.info("  Network: " + this.network);
            LOGGER.info("  App Address: " + this.appAddress);
            
        } catch (NumberFormatException e) {
            throw new RuntimeException("Invalid App ID format in configuration file", e);
        }
    }
    
    // Getters
    
    /**
     * Get the deployed smart contract App ID (numeric)
     */
    public Long getAppId() {
        return appId;
    }
    
    /**
     * Get the smart contract's address
     */
    public String getAppAddress() {
        return appAddress;
    }
    
    /**
     * Get the Algod API address
     */
    public String getAlgodAddress() {
        return algodAddress;
    }
    
    /**
     * Get the Indexer API address
     */
    public String getIndexerAddress() {
        return indexerAddress;
    }
    
    /**
     * Get the network name (testnet/mainnet)
     */
    public String getNetwork() {
        return network;
    }

    public String getAppVersion() {
        return appVersion;
    }

    public int getLockGpioPin() {
        return lockGpioPin;
    }

    public long getTimeTolerance() {
        return timeTolerance;
    }

    public long getAccessGrantDuration() {
        return accessGrantDuration;
    }
}