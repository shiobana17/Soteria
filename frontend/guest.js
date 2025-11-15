// Soteria Guest Interface - QR Code Scanner & Verification

document.addEventListener('DOMContentLoaded', () => {
    // Load configuration
    let APP_ID = 0;
    
    if (typeof SOTERIA_CONFIG !== 'undefined') {
        APP_ID = SOTERIA_CONFIG.APP_ID;
        console.log('✅ Loaded config: App ID =', APP_ID);
    } else {
        console.error('❌ SOTERIA_CONFIG not found!');
        showStatus('Configuration not loaded! Please run deploy.py', 'danger');
        return;
    }

    // Algorand TestNet Setup
    const algod_token = "";
    const algod_address = SOTERIA_CONFIG.ALGOD_SERVER || "https://testnet-api.algonode.cloud";
    const algoClient = new algosdk.Algodv2(algod_token, algod_address, '');

    const indexer_token = "";
    const indexer_address = SOTERIA_CONFIG.INDEXER_SERVER || "https://testnet-idx.algonode.cloud";
    const indexerClient = new algosdk.Indexer(indexer_token, indexer_address, '');
    
    // State
    let currentGuestAccount = null;
    let currentKeyData = null;
    let isDoorLocked = true;
    
    // Load or create persistent guest account
    function getGuestAccount() {
        const stored = localStorage.getItem('soteria_guest_account');
        
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                parsed.sk = new Uint8Array(parsed.sk);
                console.log('✅ Reusing existing guest account:', parsed.addr);
                return parsed;
            } catch (e) {
                console.warn('Failed to load stored account:', e);
            }
        }
        
        // Generate new account
        const account = algosdk.generateAccount();
        const accountData = {
            addr: account.addr,
            sk: Array.from(account.sk)
        };
        
        localStorage.setItem('soteria_guest_account', JSON.stringify(accountData));
        console.log('🎉 Created new persistent guest account:', account.addr);
        
        return account;
    }

    // DOM Elements
    const qrReader = document.getElementById('qr-reader');
    const manualEntryBtn = document.getElementById('manual-entry-btn');
    const manualEntryForm = document.getElementById('manual-entry-form');
    const manualCodeInput = document.getElementById('manual-code-input');
    const verifyManualBtn = document.getElementById('verify-manual-btn');
    const statusArea = document.getElementById('status-area');
    const doorControlsArea = document.getElementById('door-controls-area');
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
            manualEntryForm.classList.remove('d-none');
        });
    }

    function onScanSuccess(decodedText) {
        console.log('QR Code scanned:', decodedText);
        html5QrCode.stop();
        verifyAccessKey(decodedText);
    }

    function onScanError(err) {
        // Ignore continuous scanning errors
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

    // Main Verification Function - Direct Box Reading
    async function verifyAccessKey(qrData) {
        showStatus('Verifying access key...', 'info', true);

        try {
            // Step 1: Parse QR Code
            const keyData = JSON.parse(qrData);
            console.log('Parsed key data:', keyData);

            if (keyData.appId !== APP_ID) {
                throw new Error(`Invalid app ID (expected ${APP_ID}, got ${keyData.appId})`);
            }

            // Step 2: Read the box directly from the contract
            showStatus('Reading key from blockchain...', 'info', true);
            const boxData = await readBoxData(keyData.keyId);
            
            if (!boxData) {
                throw new Error('Access key not found on blockchain');
            }

            // Step 3: Parse box data and validate
            const keyInfo = parseBoxData(boxData);
            console.log('Key info:', keyInfo);

            // Step 4: Check if revoked
            if (keyInfo.status === 0) {
                addToHistory(keyData.keyName, 'denied', 'Key has been revoked');
                showStatus(`❌ Access Denied: Key has been revoked`, 'danger');
                return;
            }

            // Step 5: Check time validity
            const now = Date.now();
            
            if (now < keyInfo.validFrom) {
                const minutesUntil = Math.round((keyInfo.validFrom - now) / 60000);
                addToHistory(keyData.keyName, 'denied', `Not yet valid (${minutesUntil}m)`);
                showStatus(`❌ Access Denied: Key not yet valid (${minutesUntil} minutes)`, 'warning');
                return;
            }

            if (now > keyInfo.validUntil) {
                const minutesAgo = Math.round((now - keyInfo.validUntil) / 60000);
                addToHistory(keyData.keyName, 'denied', `Expired (${minutesAgo}m ago)`);
                showStatus(`❌ Access Denied: Key expired (${minutesAgo} minutes ago)`, 'danger');
                return;
            }

            // All checks passed!
            const remainingHours = Math.round((keyInfo.validUntil - now) / 3600000);
            addToHistory(keyData.keyName, 'granted', `${remainingHours}h remaining`);
            showStatus(`✅ Access Granted! Welcome, ${keyData.keyName}`, 'success');
            
            // Store current guest info for lock/unlock operations
            currentKeyData = keyData;
            
            // Get or create persistent guest account
            currentGuestAccount = getGuestAccount();
            console.log('Guest session account:', currentGuestAccount.addr);
            console.log('⚠️  Fund this account ONCE with TestNet ALGO to enable lock/unlock');
            console.log('👉 https://bank.testnet.algorand.network/');
            console.log('💡 This account is saved and reused across sessions');
            
            // Show door controls
            showDoorControls();

        } catch (err) {
            console.error('Verification error:', err);
            addToHistory('Unknown', 'error', err.message);
            showStatus(`❌ Verification Failed: ${err.message}`, 'danger');
        }
    }

    // Read box data directly from the blockchain
    async function readBoxData(keyId) {
        try {
            console.log('Reading box for keyId:', keyId);
            const boxNameBytes = new Uint8Array(Buffer.from(keyId));
            const response = await algoClient.getApplicationBoxByName(APP_ID, boxNameBytes).do();
            
            if (response && response.value) {
                console.log('Box data received:', response.value);
                return Buffer.from(response.value, 'base64');
            }
            return null;
        } catch (err) {
            console.error('Failed to read box:', err);
            return null;
        }
    }

    // Parse box data: recipient(32) + validFrom(8) + validUntil(8) + status(8)
    function parseBoxData(boxBuffer) {
        const boxBytes = new Uint8Array(boxBuffer);
        
        // Extract recipient address (first 32 bytes)
        const recipientBytes = boxBytes.slice(0, 32);
        const recipient = algosdk.encodeAddress(recipientBytes);
        
        // Extract valid_from (8 bytes at offset 32)
        const validFromView = new DataView(boxBytes.buffer, boxBytes.byteOffset + 32, 8);
        const validFrom = Number(validFromView.getBigUint64(0, false)) * 1000; // Convert to ms
        
        // Extract valid_until (8 bytes at offset 40)
        const validUntilView = new DataView(boxBytes.buffer, boxBytes.byteOffset + 40, 8);
        const validUntil = Number(validUntilView.getBigUint64(0, false)) * 1000; // Convert to ms
        
        // Extract status (8 bytes at offset 48)
        const statusView = new DataView(boxBytes.buffer, boxBytes.byteOffset + 48, 8);
        const status = Number(statusView.getBigUint64(0, false));
        
        return {
            recipient,
            validFrom,
            validUntil,
            status
        };
    }

    // Show door controls after verification
    function showDoorControls() {
        console.log('Showing door controls...');
        
        // Fetch current door state from blockchain before showing controls
        fetchDoorState().then(() => {
            displayDoorControls();
        });
    }
    
    // Fetch current door state from blockchain
    async function fetchDoorState() {
        try {
            console.log('Fetching door state from blockchain...');
            
            const txResponse = await indexerClient.searchForTransactions()
                .address(SOTERIA_CONFIG.APP_ADDRESS)
                .txType('pay')
                .limit(20)
                .do();
            
            if (txResponse.transactions) {
                // Find the most recent lock/unlock transaction
                for (const tx of txResponse.transactions) {
                    if (tx.note) {
                        try {
                            const noteStr = new TextDecoder().decode(Buffer.from(tx.note, 'base64'));
                            const noteData = JSON.parse(noteStr);
                            
                            if (noteData.app_id === APP_ID && 
                                (noteData.action === 'guest_unlock' || 
                                 noteData.action === 'guest_lock' ||
                                 noteData.action === 'owner_unlock' ||
                                 noteData.action === 'owner_lock')) {
                                
                                // Set state based on most recent action
                                if (noteData.action === 'guest_unlock' || noteData.action === 'owner_unlock') {
                                    isDoorLocked = false;
                                    console.log('✅ Door state: UNLOCKED');
                                } else {
                                    isDoorLocked = true;
                                    console.log('✅ Door state: LOCKED');
                                }
                                
                                // Found the most recent state, stop searching
                                break;
                            }
                        } catch (e) {
                            // Skip invalid transactions
                        }
                    }
                }
            }
        } catch (err) {
            console.error('Failed to fetch door state:', err);
            // Default to locked if we can't determine state
            isDoorLocked = true;
        }
    }
    
    // Display door controls UI
    function displayDoorControls() {
        console.log('Showing door controls...');
        
        doorControlsArea.innerHTML = `
            <div class="card glass-card mb-3 mt-3">
                <div class="card-body">
                    <h5 class="card-title mb-3">
                        <i class="bi bi-door-open me-2"></i>Door Control
                    </h5>
                    
                    <div class="alert alert-info mb-3">
                        <small>
                            <i class="bi bi-info-circle me-2"></i>
                            <strong>Testing Mode:</strong> Fund this account ONCE (it's saved and reused)
                        </small>
                        <div class="mt-2">
                            <small class="font-monospace d-block">${currentGuestAccount.addr}</small>
                            <a href="https://bank.testnet.algorand.network/" target="_blank" class="btn btn-sm btn-outline-info mt-2">
                                <i class="bi bi-wallet2 me-1"></i>Get TestNet ALGO
                            </a>
                        </div>
                    </div>
                    
                    <div class="d-flex align-items-center justify-content-between mb-3">
                        <div>
                            <p class="mb-1 fw-bold">Status:</p>
                            <p class="mb-0" id="guest-door-status">
                                <span class="badge bg-danger">
                                    <i class="bi bi-lock-fill me-1"></i>Locked
                                </span>
                            </p>
                        </div>
                        <div id="guest-lock-icon" class="text-danger" style="font-size: 3rem;">
                            <i class="bi bi-lock-fill"></i>
                        </div>
                    </div>
                    <div class="d-grid gap-2">
                        <button id="guest-unlock-btn" class="btn btn-success btn-lg">
                            <i class="bi bi-unlock me-2"></i>Unlock Door
                        </button>
                        <button id="guest-lock-btn" class="btn btn-danger btn-lg" disabled>
                            <i class="bi bi-lock me-2"></i>Lock Door
                        </button>
                    </div>
                    <div id="guest-action-status" class="mt-3"></div>
                </div>
            </div>
        `;
        
        // Attach event listeners after creating the buttons
        document.getElementById('guest-unlock-btn').addEventListener('click', guestUnlock);
        document.getElementById('guest-lock-btn').addEventListener('click', guestLock);
        
        console.log('Door controls displayed');
    }

    // Guest unlock door
    async function guestUnlock() {
        if (!currentGuestAccount || !currentKeyData) {
            showGuestActionStatus('Session expired. Please scan QR code again.', 'danger');
            return;
        }

        showGuestActionStatus('Unlocking door...', 'info', true);
        document.getElementById('guest-unlock-btn').disabled = true;
        document.getElementById('guest-lock-btn').disabled = true;

        try {
            // Create a 0 ALGO transaction with unlock action in note
            const params = await algoClient.getTransactionParams().do();
            
            const note = JSON.stringify({
                app_id: APP_ID,
                action: 'guest_unlock',
                keyId: currentKeyData.keyId,
                keyName: currentKeyData.keyName,
                timestamp: new Date().toISOString()
            });
            
            const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
                from: currentGuestAccount.addr,
                to: SOTERIA_CONFIG.APP_ADDRESS,
                amount: 0,
                note: new Uint8Array(Buffer.from(note)),
                suggestedParams: params
            });
            
            // Sign and submit
            const signedTxn = txn.signTxn(currentGuestAccount.sk);
            await algoClient.sendRawTransaction(signedTxn).do();
            
            // Update UI
            isDoorLocked = false;
            updateGuestDoorUI();
            showGuestActionStatus('✅ Door unlocked!', 'success');
            addToHistory(currentKeyData.keyName, 'granted', 'Door unlocked');
            
        } catch (err) {
            console.error('Unlock failed:', err);
            showGuestActionStatus('❌ Failed to unlock: ' + err.message, 'danger');
        } finally {
            document.getElementById('guest-unlock-btn').disabled = false;
            document.getElementById('guest-lock-btn').disabled = false;
        }
    }

    // Guest lock door
    async function guestLock() {
        if (!currentGuestAccount || !currentKeyData) {
            showGuestActionStatus('Session expired. Please scan QR code again.', 'danger');
            return;
        }

        showGuestActionStatus('Locking door...', 'info', true);
        document.getElementById('guest-unlock-btn').disabled = true;
        document.getElementById('guest-lock-btn').disabled = true;

        try {
            // Create a 0 ALGO transaction with lock action in note
            const params = await algoClient.getTransactionParams().do();
            
            const note = JSON.stringify({
                app_id: APP_ID,
                action: 'guest_lock',
                keyId: currentKeyData.keyId,
                keyName: currentKeyData.keyName,
                timestamp: new Date().toISOString()
            });
            
            const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
                from: currentGuestAccount.addr,
                to: SOTERIA_CONFIG.APP_ADDRESS,
                amount: 0,
                note: new Uint8Array(Buffer.from(note)),
                suggestedParams: params
            });
            
            // Sign and submit
            const signedTxn = txn.signTxn(currentGuestAccount.sk);
            await algoClient.sendRawTransaction(signedTxn).do();
            
            // Update UI
            isDoorLocked = true;
            updateGuestDoorUI();
            showGuestActionStatus('✅ Door locked!', 'success');
            addToHistory(currentKeyData.keyName, 'granted', 'Door locked');
            
        } catch (err) {
            console.error('Lock failed:', err);
            showGuestActionStatus('❌ Failed to lock: ' + err.message, 'danger');
        } finally {
            document.getElementById('guest-unlock-btn').disabled = false;
            document.getElementById('guest-lock-btn').disabled = false;
        }
    }

    // Update door UI
    function updateGuestDoorUI() {
        const statusEl = document.getElementById('guest-door-status');
        const iconEl = document.getElementById('guest-lock-icon');
        const unlockBtn = document.getElementById('guest-unlock-btn');
        const lockBtn = document.getElementById('guest-lock-btn');
        
        if (isDoorLocked) {
            statusEl.innerHTML = '<span class="badge bg-danger"><i class="bi bi-lock-fill me-1"></i>Locked</span>';
            iconEl.className = 'text-danger';
            iconEl.innerHTML = '<i class="bi bi-lock-fill"></i>';
            unlockBtn.disabled = false;
            lockBtn.disabled = true;
        } else {
            statusEl.innerHTML = '<span class="badge bg-success"><i class="bi bi-unlock-fill me-1"></i>Unlocked</span>';
            iconEl.className = 'text-success';
            iconEl.innerHTML = '<i class="bi bi-unlock-fill"></i>';
            unlockBtn.disabled = true;
            lockBtn.disabled = false;
        }
    }

    // Show action status
    function showGuestActionStatus(message, type = 'info', loading = false) {
        const actionStatus = document.getElementById('guest-action-status');
        if (!actionStatus) return;
        
        const iconMap = {
            success: 'check-circle-fill',
            danger: 'x-circle-fill',
            warning: 'exclamation-triangle-fill',
            info: 'info-circle-fill'
        };

        const icon = loading 
            ? '<span class="spinner-border spinner-border-sm me-2"></span>' 
            : `<i class="bi bi-${iconMap[type]} me-2"></i>`;

        actionStatus.innerHTML = `
            <div class="alert alert-${type} d-flex align-items-center mb-0" role="alert">
                ${icon}
                <span>${message}</span>
            </div>`;

        if (!loading) {
            setTimeout(() => {
                actionStatus.innerHTML = '';
            }, 3000);
        }
    }

    // Simulate door unlock
    function simulateDoorUnlock() {
        const unlockDiv = document.createElement('div');
        unlockDiv.className = 'alert alert-success text-center';
        unlockDiv.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 10000; min-width: 300px; box-shadow: 0 10px 40px rgba(0,0,0,0.3);';
        unlockDiv.innerHTML = `
            <div style="font-size: 4rem; margin-bottom: 1rem;">🔓</div>
            <h3>Access Granted!</h3>
            <p class="mb-0">Verified by Blockchain</p>
        `;
        document.body.appendChild(unlockDiv);

        setTimeout(() => {
            document.body.removeChild(unlockDiv);
            if (html5QrCode && !html5QrCode.isScanning) {
                initQRScanner();
            }
        }, 5000);
    }

    // Add to scan history
    function addToHistory(keyName, status, detail) {
        const timestamp = new Date().toLocaleTimeString();
        
        scanHistory.unshift({
            keyName,
            status,
            detail,
            timestamp
        });

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
    console.log('App ID:', APP_ID);
    console.log('Ready to scan QR codes');
    
    initQRScanner();
});