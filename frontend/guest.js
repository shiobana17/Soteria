// Soteria Guest Interface - QR Code Scanner & Verification

document.addEventListener('DOMContentLoaded', () => {
    // Algorand TestNet Setup
    const algod_token = "";
    const algod_address = "https://testnet-api.algonode.cloud";
    const algoClient = new algosdk.Algodv2(algod_token, algod_address, '');

    const indexer_token = "";
    const indexer_address = "https://testnet-idx.algonode.cloud";
    const indexerClient = new algosdk.Indexer(indexer_token, indexer_address, '');

    const APP_ID = "Soteria_v1.0";

    // DOM Elements
    const qrReader = document.getElementById('qr-reader');
    const manualEntryBtn = document.getElementById('manual-entry-btn');
    const manualEntryForm = document.getElementById('manual-entry-form');
    const manualCodeInput = document.getElementById('manual-code-input');
    const verifyManualBtn = document.getElementById('verify-manual-btn');
    const statusArea = document.getElementById('status-area');
    const recentScans = document.getElementById('recent-scans');

    let html5QrCode = null;
    let scanHistory = [];

    // Initialize QR Scanner
    function initQRScanner() {
        html5QrCode = new Html5Qrcode("qr-reader");
        
        html5QrCode.start(
            { facingMode: "environment" },
            { 
                fps: 10,
                qrbox: { width: 250, height: 250 }
            },
            onScanSuccess,
            onScanError
        ).catch(err => {
            console.error('QR Scanner init failed:', err);
            showStatus('Camera access denied or not available', 'warning');
            // Show manual entry as fallback
            manualEntryForm.classList.remove('d-none');
        });
    }

    // QR Scan Success
    function onScanSuccess(decodedText) {
        console.log('QR Code scanned:', decodedText);
        html5QrCode.stop();
        verifyAccessKey(decodedText);
    }

    // QR Scan Error (continuous, ignore)
    function onScanError(err) {
        // Ignore scanning errors (happens continuously)
    }

    // Manual Entry Toggle
    manualEntryBtn.addEventListener('click', () => {
        manualEntryForm.classList.toggle('d-none');
        if (html5QrCode && html5QrCode.isScanning) {
            html5QrCode.stop();
        }
    });

    // Manual Verification
    verifyManualBtn.addEventListener('click', () => {
        const code = manualCodeInput.value.trim();
        if (code) {
            verifyAccessKey(code);
        } else {
            showStatus('Please paste the access key', 'warning');
        }
    });

    // Main Verification Function
    async function verifyAccessKey(qrData) {
        showStatus('Verifying access key...', 'info', true);

        try {
            // Step 1: Parse QR Code
            const keyData = JSON.parse(qrData);
            console.log('Parsed key data:', keyData);

            if (keyData.appId !== APP_ID) {
                throw new Error('Invalid app ID');
            }

            // Step 2: Verify Transaction Exists on Blockchain
            showStatus('Checking blockchain...', 'info', true);
            const txExists = await verifyTransactionExists(keyData.keyId);
            if (!txExists) {
                addToHistory(keyData.keyName, 'denied', 'Transaction not found on blockchain');
                showStatus('❌ Access Denied: Key not found on blockchain', 'danger');
                return;
            }

            // Step 3: Check Revocation
            showStatus('Checking revocation status...', 'info', true);
            const isRevoked = await checkRevocation(keyData.keyId, txExists.sender);
            if (isRevoked) {
                addToHistory(keyData.keyName, 'denied', 'Key has been revoked');
                showStatus('❌ Access Denied: Key has been revoked by owner', 'danger');
                return;
            }

            // Step 4: Check Time Validity
            const now = Date.now();
            const validFrom = new Date(keyData.validFrom).getTime();
            const validUntil = new Date(keyData.validUntil).getTime();

            if (now < validFrom) {
                const minutesUntil = Math.round((validFrom - now) / 60000);
                addToHistory(keyData.keyName, 'denied', `Key not yet valid (${minutesUntil}m)`);
                showStatus(`❌ Access Denied: Key is not yet valid (starts in ${minutesUntil} minutes)`, 'warning');
                return;
            }

            if (now > validUntil) {
                const minutesAgo = Math.round((now - validUntil) / 60000);
                addToHistory(keyData.keyName, 'denied', `Key expired (${minutesAgo}m ago)`);
                showStatus(`❌ Access Denied: Key has expired (${minutesAgo} minutes ago)`, 'danger');
                return;
            }

            // All checks passed!
            const remainingHours = Math.round((validUntil - now) / 3600000);
            addToHistory(keyData.keyName, 'granted', `${remainingHours}h remaining`);
            showStatus(`✅ Access Granted! Welcome, ${keyData.keyName}`, 'success');
            
            // In production, this would trigger the physical lock
            simulateDoorUnlock();

        } catch (err) {
            console.error('Verification error:', err);
            addToHistory('Unknown', 'error', err.message);
            showStatus(`❌ Verification Failed: ${err.message}`, 'danger');
        }
    }
// Verify transaction exists on blockchain
async function verifyTransactionExists(txId) {
    try {
        const response = await indexerClient.lookupTransaction(txId).do();
        
        if (response && response.transaction) {
            const tx = response.transaction;
            console.log('Transaction found:', tx);
            
            // Verify it's a Soteria transaction
            if (tx.note) {
                // Decode the note
                let noteStr;
                if (typeof tx.note === 'string') {
                    // Base64 encoded
                    const bytes = Buffer.from(tx.note, 'base64');
                    noteStr = new TextDecoder().decode(bytes);
                } else {
                    // Already bytes
                    noteStr = new TextDecoder().decode(new Uint8Array(tx.note));
                }
                
                console.log('Transaction note:', noteStr);
                const noteData = JSON.parse(noteStr);
                
                if (noteData.app_id === APP_ID && noteData.action === 'create_guest_key') {
                    console.log('✅ Valid Soteria guest key transaction');
                    return tx;
                }
            }
        }
        console.warn('❌ Transaction not found or invalid');
        return null;
    } catch (err) {
        console.error('Transaction lookup failed:', err);
        return null;
    }
}
// Check if key has been revoked
async function checkRevocation(keyId, ownerAddress) {
    try {
        const response = await indexerClient.lookupAccountTransactions(ownerAddress).do();
        const transactions = response.transactions || [];
        
        console.log(`Checking ${transactions.length} transactions for revocations`);

        for (const tx of transactions) {
            if (tx.note) {
                try {
                    // Decode note
                    let noteStr;
                    if (typeof tx.note === 'string') {
                        const bytes = Buffer.from(tx.note, 'base64');
                        noteStr = new TextDecoder().decode(bytes);
                    } else {
                        noteStr = new TextDecoder().decode(new Uint8Array(tx.note));
                    }
                    
                    const noteData = JSON.parse(noteStr);
                    
                    if (noteData.app_id === APP_ID && 
                        noteData.action === 'revoke_guest_key' && 
                        noteData.revokes === keyId) {
                        console.log('❌ Found revocation transaction:', tx.id);
                        return true;
                    }
                } catch (e) {
                    // Skip invalid transactions
                    continue;
                }
            }
        }
        
        console.log('✅ No revocation found');
        return false;
    } catch (err) {
        console.error('Revocation check failed:', err);
        return false; // Fail open
    }
}
    // Simulate door unlock
    function simulateDoorUnlock() {
        const unlockDiv = document.createElement('div');
        unlockDiv.className = 'alert alert-success text-center';
        unlockDiv.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 10000; min-width: 300px; box-shadow: 0 10px 40px rgba(0,0,0,0.3);';
        unlockDiv.innerHTML = `
            <div style="font-size: 4rem; margin-bottom: 1rem;">🔓</div>
            <h3>Door Unlocking...</h3>
            <p class="mb-0">Access granted for 10 seconds</p>
        `;
        document.body.appendChild(unlockDiv);

        setTimeout(() => {
            unlockDiv.innerHTML = `
                <div style="font-size: 4rem; margin-bottom: 1rem;">🔒</div>
                <h3>Door Locked</h3>
                <p class="mb-0">Have a nice day!</p>
            `;
            setTimeout(() => {
                document.body.removeChild(unlockDiv);
                // Restart scanner
                if (html5QrCode && !html5QrCode.isScanning) {
                    initQRScanner();
                }
            }, 3000);
        }, 10000);
    }

    // Add to scan history
    function addToHistory(keyName, status, detail) {
        const timestamp = new Date().toLocaleTimeString();
        const statusColor = status === 'granted' ? 'success' : status === 'denied' ? 'danger' : 'warning';
        const statusIcon = status === 'granted' ? 'check-circle-fill' : status === 'denied' ? 'x-circle-fill' : 'exclamation-triangle-fill';

        scanHistory.unshift({
            keyName,
            status,
            detail,
            timestamp
        });

        // Keep only last 10
        if (scanHistory.length > 10) {
            scanHistory = scanHistory.slice(0, 10);
        }

        renderHistory();
    }

    // Render scan history
    function renderHistory() {
        if (scanHistory.length === 0) {
            recentScans.innerHTML = '<p class="text-secondary text-center small">No scans yet</p>';
            return;
        }

        recentScans.innerHTML = scanHistory.map(scan => {
            const statusColor = scan.status === 'granted' ? 'success' : scan.status === 'denied' ? 'danger' : 'warning';
            const statusIcon = scan.status === 'granted' ? 'check-circle-fill' : scan.status === 'denied' ? 'x-circle-fill' : 'exclamation-triangle-fill';
            
            return `
                <div class="mb-2 p-2 rounded" style="background: var(--bg-tertiary); border-left: 3px solid var(--accent-${statusColor === 'success' ? 'green' : statusColor === 'danger' ? 'red' : 'yellow'});">
                    <div class="d-flex justify-content-between align-items-start">
                        <div>
                            <small class="fw-semibold">
                                <i class="bi bi-${statusIcon} text-${statusColor} me-1"></i>
                                ${scan.keyName}
                            </small>
                            <br>
                            <small class="text-secondary">${scan.detail}</small>
                        </div>
                        <small class="text-secondary">${scan.timestamp}</small>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Show status message
    function showStatus(message, type = 'info', loading = false) {
        const iconMap = {
            success: 'check-circle-fill',
            danger: 'x-circle-fill',
            warning: 'exclamation-triangle-fill',
            info: 'info-circle-fill'
        };

        const icon = loading 
            ? '<span class="spinner-border spinner-border-sm me-2"></span>' 
            : `<i class="bi bi-${iconMap[type]} me-2"></i>`;

        statusArea.innerHTML = `
            <div class="alert alert-${type} d-flex align-items-center" role="alert">
                ${icon}
                <span>${message}</span>
            </div>`;

        if (!loading) {
            setTimeout(() => {
                statusArea.innerHTML = '';
            }, 5000);
        }
    }

    // Initialize
    console.log('Soteria Guest Interface initialized');
    console.log('Ready to scan QR codes');
    
    // Auto-start scanner
    initQRScanner();
});