package com.soteria.backend;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

/**
 * Result of an access verification attempt
 * Immutable class that encapsulates the outcome and reasoning
 */
public class VerificationResult {
    
    private final boolean granted;
    private final String reason;
    private final Map<String, Object> details;
    private final String timestamp;
    
    private VerificationResult(boolean granted, String reason, Map<String, Object> details) {
        this.granted = granted;
        this.reason = reason;
        this.details = details != null ? new HashMap<>(details) : new HashMap<>();
        this.timestamp = Instant.now().toString();
    }
    
    /**
     * Create a GRANTED result
     */
    public static VerificationResult grant(String reason, Map<String, Object> qrDataMap, Map<String, Object> txDataMap) {
        Map<String, Object> details = new HashMap<>();
        if (qrDataMap != null) {
            details.putAll(qrDataMap);
        }
        if (txDataMap != null) {
            details.putAll(txDataMap);
        }
        return new VerificationResult(true, reason, details);
    }
    
    /**
     * Create a DENIED result
     */
    public static VerificationResult deny(String reason) {
        return new VerificationResult(false, reason, null);
    }
    
    public boolean isGranted() {
        return granted;
    }
    
    public String getReason() {
        return reason;
    }
    
    public Map<String, Object> getDetails() {
        return new HashMap<>(details);
    }
    
    public String getTimestamp() {
        return timestamp;
    }
    
    @Override
    public String toString() {
        String status = granted ? "✓ ACCESS GRANTED" : "✗ ACCESS DENIED";
        return String.format("%s: %s (at %s)", status, reason, timestamp);
    }
    
    /**
     * Convert to JSON-friendly map
     */
    public Map<String, Object> toMap() {
        Map<String, Object> map = new HashMap<>();
        map.put("granted", granted);
        map.put("reason", reason);
        map.put("timestamp", timestamp);
        map.put("details", details);
        return map;
    }
}