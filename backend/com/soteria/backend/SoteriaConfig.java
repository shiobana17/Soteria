package com.soteria.backend;

public class SoteriaConfig {

    private final String appId = "Soteria_v1.0";
    private final String appVersion = "1.0.0";
    private final int lockGpioPin = 4; 
    private final long timeTolerance = 60L; 
    private final long accessGrantDuration = 10L; 

    public String getAppId() {
        return appId;
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