// Soteria Security Dashboard - Frontend Application Logic
// 
// PROJECT ARCHITECTURE:
// This frontend serves as "Mission Control" - a stateless web interface that:
// 1. Connects to the user's Algorand wallet (their identity & authority)
// 2. Creates cryptographically signed transactions for all actions
// 3. Reads the immutable activity log from the Algorand blockchain
// 4. Generates QR codes that the IoT backend can verify trustlessly
//
// TRUST MODEL:
// - The frontend trusts: The user's wallet signature, Algorand blockchain
// - The frontend does NOT trust: Any central server, cached data, itself
// - All state is derived from on-chain transactions
//
// BACKEND VERIFICATION:
// When the IoT device scans a QR code, it performs these checks:
// 1. Parse & Sanitize: Validate QR code structure
// 2. Authenticity: Verify transaction exists on-chain with matching data
// 3. Revocation: Search blockchain for any revoke_guest_key transaction
// 4. Time-Lock: Check if current time falls within validity window
//
// Only if ALL checks pass does the backend grant access.

document.addEventListener('DOMContentLoaded', () => {
    // Check if libraries are loaded
    if (typeof PeraWalletConnect === 'undefined') {
        console.error('PeraWalletConnect not loaded!');
        alert('Failed to load wallet library. Please refresh the page.');
        return;
    }
    
    if (typeof algosdk === 'undefined') {
        console.error('AlgoSDK not loaded!');
        alert('Failed to load Algorand SDK. Please refresh the page.');
        return;
    }
    
    // Algorand Setup
    const peraWallet = new PeraWalletConnect();
    // Setup to facilitate sandbox
    const algod_token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const algod_address = "http://localhost:4001";
    const algoClient = new algosdk.Algodv2(algod_token, algod_address, '');

const indexer_token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const indexer_address = "http://localhost:8980";
const indexerClient = new algosdk.Indexer(indexer_token, indexer_address, '');
    
    // Application identifier - must match backend verification
    const APP_ID = "Soteria_v1.0";
    const APP_VERSION = "1.0.0";
    
    console.log('Soteria initializing...');
    console.log('PeraWallet:', peraWallet);
    console.log('AlgoSDK:', algosdk);

    // State
    let userAccount = null;
    let isLocked = true;
    let allTransactions = [];

    // DOM Elements
    const connectWalletBtn = document.getElementById('connect-wallet-btn');
    const unlockBtn = document.getElementById('unlock-btn');
    const lockBtn = document.getElementById('lock-btn');
    const lockStatusText = document.getElementById('lock-status-text');
    const lockIcon = document.getElementById('lock-icon');
    const infoAlert = document.getElementById('info-alert');
    const logContainer = document.getElementById('log-container');
    const logPlaceholder = document.getElementById('log-placeholder');
    const guestKeyList = document.getElementById('guest-key-list');
    const createKeyForm = document.getElementById('create-key-form');

    // Bootstrap Modals
    const createKeyModal = new bootstrap.Modal(document.getElementById('createKeyModal'));
    const qrCodeModal = new bootstrap.Modal(document.getElementById('qrCodeModal'));

    // Initialize UI
    updateLockButtonStates();

    // Auto-reconnect wallet on page load
    peraWallet.reconnectSession().then(accounts => {
        if (accounts.length) {
            userAccount = accounts[0];
            updateUIForConnectedState();
        }
    }).catch(err => {
        console.error('Failed to reconnect:', err);
    });

    // Event Listeners
    connectWalletBtn.addEventListener('click', handleConnectWallet);
    unlockBtn.addEventListener('click', () => handleLockAction('unlock'));
    lockBtn.addEventListener('click', () => handleLockAction('lock'));
    createKeyForm.addEventListener('submit', handleCreateKey);

    // Wallet Connection
    function handleConnectWallet() {
        peraWallet.connect()
            .then(accounts => {
                userAccount = accounts[0];
                updateUIForConnectedState();
                showAlert('Wallet connected successfully!', 'success');
            })
            .catch(err => {
                if (err?.data?.type !== 'SESSION_CONNECT') {
                    console.error('Connection error:', err);
                    showAlert('Failed to connect wallet', 'danger');
                }
            });
    }

    function updateUIForConnectedState() {
        const shortAddr = `${userAccount.substring(0, 6)}...${userAccount.slice(-4)}`;
        connectWalletBtn.innerHTML = `<i class="bi bi-wallet2 me-2"></i>${shortAddr}`;
        logPlaceholder.style.display = 'none';
        fetchActivityLogs();
    }

    // Lock/Unlock Actions
    async function handleLockAction(action) {
        if (!userAccount) {
            showAlert('Please connect your wallet first', 'warning');
            return;
        }

        try {
            await signAndSendTransaction({ action }, action);
            isLocked = action === 'lock';
            updateLockUI();
            await fetchActivityLogs();
        } catch (err) {
            console.error('Action failed:', err);
        } finally {
            updateLockButtonStates();
        }
    }

    // Create Guest Key
    async function handleCreateKey(e) {
        e.preventDefault();

        const details = {
            name: document.getElementById('key-name').value.trim(),
            recipient: document.getElementById('recipient-wallet').value.trim(),
            validFrom: document.getElementById('start-date').value,
            validUntil: document.getElementById('end-date').value
        };

        // Validation
        if (!algosdk.isValidAddress(details.recipient)) {
            showAlert('Invalid Algorand address', 'danger');
            return;
        }

        const startTime = new Date(details.validFrom).getTime();
        const endTime = new Date(details.validUntil).getTime();

        if (endTime <= startTime) {
            showAlert('End time must be after start time', 'danger');
            return;
        }

        if (startTime < Date.now()) {
            showAlert('Start time cannot be in the past', 'danger');
            return;
        }

        try {
            await signAndSendTransaction({ action: 'create_guest_key', details }, 'create guest key');
            createKeyForm.reset();
            createKeyModal.hide();
            await fetchActivityLogs();
            showAlert('Guest key created successfully!', 'success');
        } catch (err) {
            console.error('Create key failed:', err);
        }
    }

    // Revoke Guest Key
    async function handleRevokeKey(keyId) {
        if (!confirm('Are you sure you want to revoke this guest key? This action cannot be undone.')) {
            return;
        }

        try {
            await signAndSendTransaction({ action: 'revoke_guest_key', revokes: keyId }, 'revoke guest key');
            await fetchActivityLogs();
            showAlert('Guest key revoked successfully', 'warning');
        } catch (err) {
            console.error('Revoke failed:', err);
        }
    }

    // Sign and Send Transaction
    async function signAndSendTransaction(data, purpose) {
        if (!userAccount) {
            throw new Error('Wallet not connected');
        }

        showAlert(`Signing transaction to ${purpose}...`, 'info', true);
        setAllButtonsDisabled(true);

        try {
            const params = await algoClient.getTransactionParams().do();
            
            const noteData = {
                app_id: APP_ID,
                timestamp: new Date().toISOString(),
                ...data
            };
            
            const note = new Uint8Array(Buffer.from(JSON.stringify(noteData)));

            const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
                from: userAccount,
                to: userAccount,
                amount: 0,
                note,
                suggestedParams: params
            });

            const signedTxn = await peraWallet.signTransaction([[{ 
                txn, 
                signers: [userAccount] 
            }]]);

            showAlert('Sending transaction...', 'info', true);
            const { txId } = await algoClient.sendRawTransaction(signedTxn).do();

            showAlert('Confirming transaction...', 'info', true);
            await algosdk.waitForConfirmation(algoClient, txId, 4);

            showAlert(`Successfully ${purpose}ed!`, 'success');
        } catch (err) {
            console.error('Transaction error:', err);
            showAlert('Transaction failed or rejected', 'danger');
            throw err;
        } finally {
            setAllButtonsDisabled(false);
            updateLockButtonStates();
        }
    }

    // Fetch Activity Logs
    async function fetchActivityLogs() {
        if (!userAccount) return;

        logContainer.innerHTML = `
            <div class="text-center mt-5">
                <div class="spinner-border text-info" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <p class="text-secondary mt-3">Loading activity logs...</p>
            </div>`;

        try {
            const response = await indexerClient.lookupAccountTransactions(userAccount).do();
            const transactions = response.transactions || [];

            const soteriaTxs = transactions
                .map(tx => {
                    try {
                        if (!tx.note) return null;
                        const noteStr = Buffer.from(tx.note, 'base64').toString('utf8');
                        const note = JSON.parse(noteStr);
                        if (note?.app_id === APP_ID) {
                            return { ...tx, noteData: note };
                        }
                    } catch (e) {
                        // Invalid note format, skip
                    }
                    return null;
                })
                .filter(Boolean)
                .sort((a, b) => b['round-time'] - a['round-time']);

            allTransactions = soteriaTxs;
            renderLogsAndKeys(soteriaTxs);
        } catch (err) {
            console.error('Failed to fetch logs:', err);
            logContainer.innerHTML = `
                <div class="text-center mt-5">
                    <i class="bi bi-exclamation-triangle text-danger" style="font-size: 3rem;"></i>
                    <p class="text-danger mt-3">Failed to load activity logs</p>
                    <button class="btn btn-sm btn-outline-info" onclick="location.reload()">Retry</button>
                </div>`;
        }
    }

    // Render Logs and Keys
    function renderLogsAndKeys(txs) {
        const guestKeys = {};
        const revokedKeys = new Set();

        // Process transactions to extract keys and revocations
        txs.forEach(tx => {
            const { action, revokes } = tx.noteData;
            if (action === 'create_guest_key') {
                guestKeys[tx.id] = tx;
            } else if (action === 'revoke_guest_key') {
                revokedKeys.add(revokes);
            }
        });

        // Render Guest Keys
        const keyIds = Object.keys(guestKeys);
        if (keyIds.length > 0) {
            guestKeyList.innerHTML = keyIds.map(id => 
                createGuestKeyElement(guestKeys[id], revokedKeys.has(id))
            ).join('');
        } else {
            guestKeyList.innerHTML = '<p class="text-secondary text-center py-4">No guest keys created yet</p>';
        }

        // Render Activity Logs
        if (txs.length > 0) {
            logContainer.innerHTML = txs.map(createLogElement).join('');
        } else {
            logContainer.innerHTML = `
                <div class="text-center" style="margin-top: 20vh;">
                    <i class="bi bi-inbox" style="font-size: 3rem; opacity: 0.3;"></i>
                    <p class="text-secondary mt-3">No activity yet</p>
                </div>`;
        }
    }

    // Create Log Element HTML
    function createLogElement(tx) {
        const { action, timestamp, details } = tx.noteData;
        let icon, title, subtitle, color;

        switch (action) {
            case 'unlock':
                color = 'success';
                icon = 'unlock-fill';
                title = 'Device Unlocked';
                subtitle = `By ${userAccount.substring(0, 6)}...`;
                break;
            case 'lock':
                color = 'danger';
                icon = 'lock-fill';
                title = 'Device Locked';
                subtitle = `By ${userAccount.substring(0, 6)}...`;
                break;
            case 'create_guest_key':
                color = 'info';
                icon = 'person-plus-fill';
                title = 'Guest Key Created';
                subtitle = `${details.name} for ${details.recipient.substring(0, 6)}...`;
                break;
            case 'revoke_guest_key':
                color = 'warning';
                icon = 'x-octagon-fill';
                title = 'Guest Key Revoked';
                subtitle = `Key ID ${tx.noteData.revokes.substring(0, 8)}...`;
                break;
            default:
                return '';
        }

        const date = new Date(timestamp);
        const formattedDate = date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        return `
            <div class="log-item">
                <div class="d-flex align-items-center gap-3">
                    <i class="bi bi-${icon} text-${color} fs-3"></i>
                    <div class="flex-grow-1">
                        <p class="mb-1 fw-semibold">${title}</p>
                        <p class="mb-0 small text-secondary">${subtitle}</p>
                        <p class="mb-0 small text-secondary">
                            <i class="bi bi-clock me-1"></i>${formattedDate}
                        </p>
                    </div>
                    <a href="https://testnet.algoexplorer.io/tx/${tx.id}" 
                       target="_blank" 
                       rel="noopener noreferrer" 
                       class="btn btn-sm btn-outline-secondary"
                       title="View on Algorand Explorer">
                        <i class="bi bi-box-arrow-up-right"></i>
                    </a>
                </div>
            </div>`;
    }

    // Create Guest Key Element HTML
    function createGuestKeyElement(tx, isRevoked) {
        const { details } = tx.noteData;
        const statusBadge = isRevoked 
            ? '<span class="badge bg-danger">Revoked</span>' 
            : '<span class="badge bg-success">Active</span>';
        
        const shortRecipient = `${details.recipient.substring(0, 8)}...${details.recipient.slice(-6)}`;
        
        const startDate = new Date(details.validFrom).toLocaleDateString();
        const endDate = new Date(details.validUntil).toLocaleDateString();

        return `
            <div class="guest-key-item">
                <div class="d-flex justify-content-between align-items-center">
                    <div class="flex-grow-1">
                        <p class="mb-1 fw-semibold">
                            <i class="bi bi-key me-1"></i>${details.name} ${statusBadge}
                        </p>
                        <p class="mb-0 small text-secondary">
                            <i class="bi bi-person me-1"></i>${shortRecipient}
                        </p>
                        <p class="mb-0 small text-secondary">
                            <i class="bi bi-calendar-range me-1"></i>${startDate} - ${endDate}
                        </p>
                    </div>
                    <div class="btn-group">
                        <button class="btn btn-sm btn-outline-info" 
                                onclick="window.showQRCode('${tx.id}')" 
                                ${isRevoked ? 'disabled' : ''}
                                title="View QR Code">
                            <i class="bi bi-qr-code"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" 
                                onclick="window.revokeGuestKey('${tx.id}')" 
                                ${isRevoked ? 'disabled' : ''}
                                title="Revoke Key">
                            <i class="bi bi-trash-fill"></i>
                        </button>
                    </div>
                </div>
            </div>`;
    }

    // Display QR Code
    function displayQRCode(txId) {
        const tx = allTransactions.find(t => t.id === txId);
        if (!tx) return;

        const { details } = tx.noteData;
        
        // QR Code data structure - CRITICAL: Must match backend verification expectations
        const qrData = JSON.stringify({
            version: APP_VERSION,
            keyId: txId,              // Transaction ID for authenticity verification
            recipient: details.recipient,  // Who can use this key
            validFrom: details.validFrom,  // ISO timestamp
            validUntil: details.validUntil, // ISO timestamp
            keyName: details.name,         // Human-readable identifier
            appId: APP_ID,                 // Application identifier
            createdAt: tx.noteData.timestamp // When the key was created
        });

        const qrContainer = document.getElementById('qr-container');
        qrContainer.innerHTML = ''; // Clear previous QR code

        // Generate QR Code with high error correction for reliability
        new QRCode(qrContainer, {
            text: qrData,
            width: 256,
            height: 256,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });

        // Display key details
        const startDate = new Date(details.validFrom).toLocaleString();
        const endDate = new Date(details.validUntil).toLocaleString();
        const createdDate = new Date(tx.noteData.timestamp).toLocaleString();

        document.getElementById('qr-key-details').innerHTML = `
            <p class="mb-2"><strong><i class="bi bi-tag me-2"></i>Key Name:</strong> ${details.name}</p>
            <p class="mb-2 text-break"><strong><i class="bi bi-person me-2"></i>Recipient:</strong> ${details.recipient}</p>
            <p class="mb-2"><strong><i class="bi bi-calendar-check me-2"></i>Valid From:</strong> ${startDate}</p>
            <p class="mb-2"><strong><i class="bi bi-calendar-x me-2"></i>Valid Until:</strong> ${endDate}</p>
            <p class="mb-2 small text-secondary"><strong><i class="bi bi-clock-history me-2"></i>Created:</strong> ${createdDate}</p>
            <p class="mb-0 small text-secondary"><strong><i class="bi bi-fingerprint me-2"></i>Key ID:</strong> ${txId.substring(0, 16)}...</p>
            <div class="alert alert-info mt-3 mb-0 small">
                <i class="bi bi-info-circle me-2"></i>
                <strong>Backend Verification:</strong> This QR code will be validated against the Algorand blockchain by the IoT device.
            </div>
        `;

        qrCodeModal.show();
    }

    // UI Helper Functions
    function updateLockUI() {
        const statusIndicator = lockStatusText.querySelector('.status-indicator');
        const statusSpan = lockStatusText.querySelector('span:last-child');

        if (isLocked) {
            lockIcon.className = 'lock-icon-wrapper locked';
            lockIcon.innerHTML = '<i class="bi bi-lock-fill" style="font-size: 2rem;"></i>';
            statusIndicator.className = 'status-indicator bg-danger';
            statusSpan.textContent = 'Locked';
        } else {
            lockIcon.className = 'lock-icon-wrapper unlocked';
            lockIcon.innerHTML = '<i class="bi bi-unlock-fill" style="font-size: 2rem;"></i>';
            statusIndicator.className = 'status-indicator bg-success';
            statusSpan.textContent = 'Unlocked';
        }
    }

    function updateLockButtonStates() {
        lockBtn.disabled = isLocked;
        unlockBtn.disabled = !isLocked;
    }

    function setAllButtonsDisabled(disabled) {
        lockBtn.disabled = disabled;
        unlockBtn.disabled = disabled;
        document.getElementById('create-key-btn').disabled = disabled;
    }

    function showAlert(message, type = 'info', loading = false) {
        const iconMap = {
            success: 'check-circle-fill',
            danger: 'exclamation-triangle-fill',
            warning: 'exclamation-circle-fill',
            info: 'info-circle-fill'
        };

        const icon = loading 
            ? '<span class="spinner-border spinner-border-sm me-2"></span>' 
            : `<i class="bi bi-${iconMap[type]} me-2"></i>`;

        infoAlert.innerHTML = `
            <div class="alert alert-${type} alert-custom d-flex align-items-center mb-0" role="alert">
                ${icon}
                <span>${message}</span>
            </div>`;

        if (!loading) {
            setTimeout(() => {
                infoAlert.innerHTML = '';
            }, 5000);
        }
    }

    // Global functions for onclick handlers
    window.showQRCode = displayQRCode;
    window.revokeGuestKey = handleRevokeKey;

    // Disconnect wallet function
    window.disconnectWallet = async () => {
        await peraWallet.disconnect();
        userAccount = null;
        location.reload();
    };

    // Utility function to verify a key's current status (for testing/debugging)
    window.verifyKeyStatus = async (txId) => {
        console.log('=== Key Verification Debug ===');
        const tx = allTransactions.find(t => t.id === txId);
        if (!tx) {
            console.error('Transaction not found');
            return;
        }

        const { details } = tx.noteData;
        
        // Check 1: Authenticity (transaction exists on-chain)
        console.log('✓ Authenticity: Transaction found on-chain');
        console.log('  TX ID:', txId);
        
        // Check 2: Revocation status
        const isRevoked = allTransactions.some(t => 
            t.noteData.action === 'revoke_guest_key' && 
            t.noteData.revokes === txId
        );
        console.log(isRevoked ? '✗ Revocation: Key has been revoked' : '✓ Revocation: Key is active');
        
        // Check 3: Time-lock validity
        const now = Date.now();
        const validFrom = new Date(details.validFrom).getTime();
        const validUntil = new Date(details.validUntil).getTime();
        const isTimeValid = now >= validFrom && now <= validUntil;
        
        console.log(isTimeValid ? '✓ Time-Lock: Currently valid' : '✗ Time-Lock: Outside validity window');
        console.log('  Valid From:', new Date(validFrom).toLocaleString());
        console.log('  Valid Until:', new Date(validUntil).toLocaleString());
        console.log('  Current Time:', new Date(now).toLocaleString());
        
        // Final verdict
        const shouldGrantAccess = !isRevoked && isTimeValid;
        console.log('\n=== Final Verdict ===');
        console.log(shouldGrantAccess ? '✓ ACCESS GRANTED' : '✗ ACCESS DENIED');
        console.log('====================');
        
        return shouldGrantAccess;
    };

    // Export transaction data for backend testing (development helper)
    window.exportKeyData = (txId) => {
        const tx = allTransactions.find(t => t.id === txId);
        if (!tx) {
            console.error('Transaction not found');
            return;
        }

        const exportData = {
            transactionId: tx.id,
            owner: userAccount,
            noteData: tx.noteData,
            roundTime: tx['round-time'],
            confirmedRound: tx['confirmed-round']
        };

        console.log('Key Data Export:', JSON.stringify(exportData, null, 2));
        return exportData;
    };

    console.log('Soteria Dashboard v' + APP_VERSION + ' initialized');
    console.log('App ID:', APP_ID);
    console.log('Connected to Algorand TestNet');
});