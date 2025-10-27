package com.soteria.backend;

import java.util.logging.Logger;

/**
 * Placeholder for a real hardware lock controller (e.g., using Pi4J for Raspberry Pi).
 * This stub class provides the methods needed for SoteriaBackend to compile and run,
 * and it logs the actions to the console.
 */
public class LockController {

    private static final Logger LOGGER = Logger.getLogger(LockController.class.getName());
    private final int lockPin;
    private boolean isLocked = true;

    public LockController(int gpioPin) {
        this.lockPin = gpioPin;
        LOGGER.info("Lock Controller initialized for GPIO pin: " + lockPin);
        // In a real application, you would initialize the GPIO pin here.
    }

    /**
     * Simulates unlocking the physical door.
     */
    public void unlock() {
        if (isLocked) {
            LOGGER.info("SIMULATING: Sending UNLOCK signal to pin " + lockPin);
            // Real hardware logic (e.g., send high signal) would go here.
            isLocked = false;
        } else {
            LOGGER.info("SIMULATING: Lock is already unlocked.");
        }
    }

    /**
     * Simulates locking the physical door.
     */
    public void lock() {
        if (!isLocked) {
            LOGGER.info("SIMULATING: Sending LOCK signal to pin " + lockPin);
            // Real hardware logic (e.g., send low signal) would go here.
            isLocked = true;
        } else {
            LOGGER.info("SIMULATING: Lock is already locked.");
        }
    }
}