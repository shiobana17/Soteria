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
    // Connect to Algorand Public TestNet
const algod_token = "";
const algod_address = "https://testnet-api.algonode.cloud";
const algoClient = new algosdk.Algodv2(algod_token, algod_address, '');

const indexer_token = "";
const indexer_address = "https://testnet-idx.algonode.cloud";
const indexerClient = new algosdk.Indexer(indexer_token, indexer_address, '');
    
    // Application identifier - must match backend verification
    const APP_ID = "Soteria_v1.0";
    const APP_VERSION = "1.0.0";
// AUTO-GENERATE DEV ACCOUNT (NO MNEMONIC NEEDED)
let devAccount = null;
const storedAccount = localStorage.getItem('soteria_dev_account');

if (storedAccount) {
    // Use existing dev account
    devAccount = JSON.parse(storedAccount);
    console.log('✅ Dev account loaded:', devAccount.addr);
} else {
    // Generate new account (first time only)
    const account = algosdk.generateAccount();
    devAccount = {
        addr: account.addr,
        sk: Array.from(account.sk)
    };
    localStorage.setItem('soteria_dev_account', JSON.stringify(devAccount));
    
    const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
    console.log('='.repeat(60));
    console.log('🎉 NEW DEV ACCOUNT GENERATED!');
    console.log('Address:', devAccount.addr);
    console.log('Mnemonic (save this!):', mnemonic);
    console.log('='.repeat(60));
    console.log('⚠️  FUND THIS ADDRESS WITH TESTNET ALGO:');
    console.log('👉 https://bank.testnet.algorand.network/');
    console.log('='.repeat(60));
    
    alert(`New dev account created!\n\nAddress: ${devAccount.addr}\n\nFund it at: https://bank.testnet.algorand.network/\n\nCheck console for mnemonic to save.`);
}

    // State
    let userAccount = null;
    let isLocked = true;
    let allTransactions = [];

devAccount.sk = new Uint8Array(devAccount.sk);
userAccount = devAccount.addr;
console.log('Auto-connected with dev account:', userAccount);

    console.log("ITR") // Signature
// Update UI immediately
setTimeout(() => {
    updateUIForConnectedState();
}, 500);

    console.log('Soteria initializing...');
    console.log('PeraWallet:', peraWallet);
    console.log('AlgoSDK:', algosdk);



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


// Verify critical elements exist
if (!logContainer) console.error('❌ logContainer not found!');
if (!guestKeyList) console.error('❌ guestKeyList not found!');
if (!connectWalletBtn) console.error('❌ connectWalletBtn not found!');

    // Bootstrap Modals
    const createKeyModal = new bootstrap.Modal(document.getElementById('createKeyModal'));
    const qrCodeModal = new bootstrap.Modal(document.getElementById('qrCodeModal'));

    // Initialize UI
    updateLockButtonStates();

    // Event Listeners
    connectWalletBtn.addEventListener('click', handleConnectWallet);
    unlockBtn.addEventListener('click', () => handleLockAction('unlock'));
    lockBtn.addEventListener('click', () => handleLockAction('lock'));
    createKeyForm.addEventListener('submit', handleCreateKey);

// Wallet Connection
function handleConnectWallet() {
    // For dev mode, just use the dev account
    if (devAccount) {
        userAccount = devAccount.addr;
        updateUIForConnectedState();
        showAlert('Dev wallet connected!', 'success');
        return;
    }
    
    // Fallback to Pera Wallet
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
    if (!userAccount) {
        console.error('No user account set!');
        return;
    }
    
    const shortAddr = `${userAccount.substring(0, 6)}...${userAccount.slice(-4)}`;
    connectWalletBtn.innerHTML = `<i class="bi bi-wallet2 me-2"></i>${shortAddr}`;
    connectWalletBtn.classList.remove('btn-info');
    connectWalletBtn.classList.add('btn-success');
    
    // Hide the placeholder
    if (logPlaceholder) {
        logPlaceholder.style.display = 'none';
    }
    
    console.log('Fetching activity logs for:', userAccount);
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

    // Create Guest Key - FIXED TIMEZONE ISSUE
    async function handleCreateKey(e) {
        e.preventDefault();

        const keyName = document.getElementById('key-name').value.trim();
        const recipient = document.getElementById('recipient-wallet').value.trim();
        const startDateInput = document.getElementById('start-date').value;
        const endDateInput = document.getElementById('end-date').value;

        // Validation
        if (!algosdk.isValidAddress(recipient)) {
            showAlert('Invalid Algorand address', 'danger');
            return;
        }

        // CRITICAL FIX: Convert to ISO 8601 format with proper timezone handling
        const validFrom = new Date(startDateInput).toISOString();
        const validUntil = new Date(endDateInput).toISOString();
        
        const startTime = new Date(validFrom).getTime();
        const endTime = new Date(validUntil).getTime();

        console.log('🕐 Time conversion:');
        console.log('  Input start:', startDateInput);
        console.log('  ISO start:', validFrom);
        console.log('  Input end:', endDateInput);
        console.log('  ISO end:', validUntil);

        if (endTime <= startTime) {
            showAlert('End time must be after start time', 'danger');
            return;
        }

        if (startTime < Date.now()) {
            showAlert('Start time cannot be in the past', 'danger');
            return;
        }

        const details = {
            name: keyName,
            recipient: recipient,
            validFrom: validFrom,  // ISO 8601 format
            validUntil: validUntil  // ISO 8601 format
        };

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
        if (!confirm('Are you sure you want to revoke this guest key?\n\n⚠️ This action cannot be undone and will immediately block all access for this key.')) {
            return;
        }

        try {
            showAlert('Revoking key...', 'info', true);
            await signAndSendTransaction({ action: 'revoke_guest_key', revokes: keyId }, 'revoke guest key');
            await fetchActivityLogs();
            showAlert('✅ Guest key revoked successfully', 'warning');
        } catch (err) {
            console.error('Revoke failed:', err);
            showAlert('Failed to revoke key', 'danger');
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
        
        console.log('Creating transaction with note:', noteData);
        const note = Buffer.from(JSON.stringify(noteData));

        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            from: userAccount,
            to: userAccount,
            amount: 0,
            note,
            suggestedParams: params
        });

        if (!devAccount) {
            throw new Error('Dev account not configured');
        }
        const signedTxn = txn.signTxn(devAccount.sk);

        showAlert('Sending transaction...', 'info', true);
        const { txId } = await algoClient.sendRawTransaction(signedTxn).do();
        console.log('Transaction sent:', txId);

        showAlert('Confirming transaction...', 'info', true);
        await algosdk.waitForConfirmation(algoClient, txId, 4);
        console.log('Transaction confirmed:', txId);

        showAlert(`Successfully ${purpose}ed!`, 'success');
        
        // Wait a bit for indexer to catch up, then refresh logs
        setTimeout(() => {
            console.log('Refreshing activity logs...');
            fetchActivityLogs();
        }, 2000);
        
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
    if (!userAccount) {
        console.error('Cannot fetch logs: userAccount not set');
        return;
    }

    console.log('Fetching logs for account:', userAccount);

    logContainer.innerHTML = `
        <div class="text-center mt-5">
            <div class="spinner-border text-info" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <p class="text-secondary mt-3">Loading activity logs...</p>
        </div>`;

    try {
        console.log('Calling indexer for:', userAccount);
        const response = await indexerClient.lookupAccountTransactions(userAccount).do();
        console.log('Indexer response:', response);
        
        const transactions = response.transactions || [];
        console.log(`Found ${transactions.length} total transactions`);

        const soteriaTxs = transactions
            .map(tx => {
                try {
                    if (!tx.note) return null;
                    
                    // Properly decode the note
                    let noteStr;
                    if (typeof tx.note === 'string') {
                        // Base64 string - decode it
                        noteStr = atob(tx.note);
                    } else if (tx.note instanceof Uint8Array || Array.isArray(tx.note)) {
                        // Already bytes - convert to string
                        noteStr = new TextDecoder().decode(new Uint8Array(tx.note));
                    } else {
                        console.warn('Unknown note format:', typeof tx.note);
                        return null;
                    }
                    
                    console.log('Decoded note:', noteStr);
                    const note = JSON.parse(noteStr);
                    
                    if (note?.app_id === APP_ID) {
                        console.log('✅ Found Soteria tx:', tx.id, 'action:', note.action);
                        return { ...tx, noteData: note };
                    }
                } catch (e) {
                    console.log('Failed to parse note:', e.message);
                }
                return null;
            })
            .filter(Boolean)
            .sort((a, b) => b['round-time'] - a['round-time']);

        console.log(`Found ${soteriaTxs.length} Soteria transactions`);
        allTransactions = soteriaTxs;
        renderLogsAndKeys(soteriaTxs);
    } catch (err) {
        console.error('Failed to fetch logs:', err);
        logContainer.innerHTML = `
            <div class="text-center mt-5">
                <i class="bi bi-exclamation-triangle text-danger" style="font-size: 3rem;"></i>
                <p class="text-danger mt-3">Failed to load activity logs</p>
                <p class="text-secondary small">${err.message}</p>
                <button class="btn btn-sm btn-outline-info" onclick="location.reload()">Retry</button>
            </div>`;
    }
}

// Render Logs and Keys
function renderLogsAndKeys(txs) {
    console.log('Rendering logs and keys for', txs.length, 'transactions');
    
    const guestKeys = {};
    const revokedKeys = new Set();

    // Process transactions to extract keys and revocations
    txs.forEach(tx => {
        const { action, revokes } = tx.noteData;
        if (action === 'create_guest_key') {
            guestKeys[tx.id] = tx;
            console.log('Found guest key:', tx.id);
        } else if (action === 'revoke_guest_key') {
            revokedKeys.add(revokes);
            console.log('Found revocation for:', revokes);
        }
    });

    // Render Guest Keys
    const keyIds = Object.keys(guestKeys);
    console.log('Rendering', keyIds.length, 'guest keys');
    
    if (keyIds.length > 0) {
        guestKeyList.innerHTML = keyIds.map(id => 
            createGuestKeyElement(guestKeys[id], revokedKeys.has(id))
        ).join('');
    } else {
        guestKeyList.innerHTML = '<p class="text-secondary text-center py-4">No guest keys created yet</p>';
    }

    // Render Activity Logs
    console.log('Rendering', txs.length, 'activity log entries');
    
    if (txs.length > 0) {
        logContainer.innerHTML = txs.map(createLogElement).join('');
    } else {
        logContainer.innerHTML = `
            <div class="text-center" style="margin-top: 20vh;">
                <i class="bi bi-inbox" style="font-size: 3rem; opacity: 0.3;"></i>
                <p class="text-secondary mt-3">No activity yet</p>
                <p class="text-secondary small">Try unlocking/locking the door or creating a guest key</p>
            </div>`;
    }
}

// Create Log Element HTML
function createLogElement(tx) {
    const { action, timestamp, details } = tx.noteData;
    let icon, title, subtitle, color;

    console.log('Creating log element for action:', action);

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
        case 'guest_access':
            color = 'success';
            icon = 'door-open-fill';
            title = '🚪 Guest Accessed Door';
            subtitle = `${tx.noteData.keyName} entered`;
            break;
        case 'guest_access_denied':
            color = 'danger';
            icon = 'shield-x-fill';
            title = '⛔ Access Denied';
            subtitle = `${tx.noteData.keyName} - ${tx.noteData.reason}`;
            break;
        default:
            console.warn('Unknown action type:', action);
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

    const html = `
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
<a href="https://testnet.algoscan.app/tx/${tx.id}" 
   target="_blank" 
   rel="noopener noreferrer" 
   class="btn btn-sm btn-outline-secondary"
   title="View on AlgoScan">
    <i class="bi bi-box-arrow-up-right"></i>
</a>
            </div>
        </div>`;
    
    return html;
}

    // Create Guest Key Element HTML - WITH REVOKE BUTTON
    function createGuestKeyElement(tx, isRevoked) {
        const { details } = tx.noteData;
        
        // Check if key is expired
        const now = Date.now();
        const validUntil = new Date(details.validUntil).getTime();
        const isExpired = now > validUntil;
        
        // Status badge
        let statusBadge = '';
        if (isRevoked) {
            statusBadge = '<span class="badge bg-danger ms-2">Revoked</span>';
        } else if (isExpired) {
            statusBadge = '<span class="badge bg-secondary ms-2">Expired</span>';
        } else {
            statusBadge = '<span class="badge bg-success ms-2">Active</span>';
        }
        
        const shortRecipient = `${details.recipient.substring(0, 8)}...${details.recipient.slice(-6)}`;
        
        const startDate = new Date(details.validFrom).toLocaleString();
        const endDate = new Date(details.validUntil).toLocaleString();

        return `
            <div class="guest-key-item">
                <div class="d-flex justify-content-between align-items-center">
                    <div class="flex-grow-1">
                        <p class="mb-1 fw-semibold">
                            <i class="bi bi-key me-1"></i>${details.name}${statusBadge}
                        </p>
                        <p class="mb-0 small text-secondary">
                            <i class="bi bi-person me-1"></i>${shortRecipient}
                        </p>
                        <p class="mb-0 small text-secondary">
                            <i class="bi bi-calendar-range me-1"></i>${startDate} → ${endDate}
                        </p>
                    </div>
                    <div class="btn-group">
                        <button class="btn btn-sm btn-outline-info" 
                                onclick="window.showQRCode('${tx.id}')" 
                                ${isRevoked || isExpired ? 'disabled' : ''}
                                title="View QR Code">
                            <i class="bi bi-qr-code"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" 
                                onclick="window.revokeGuestKey('${tx.id}')" 
                                ${isRevoked || isExpired ? 'disabled' : ''}
                                title="Revoke Access">
                            <i class="bi bi-x-circle"></i>
                        </button>
                    </div>
                </div>
            </div>`;
    }

// Display QR Code - FIXED TO MATCH BACKEND EXPECTATIONS
function displayQRCode(txId) {
    const tx = allTransactions.find(t => t.id === txId);
    if (!tx) return;

    const { details } = tx.noteData;
    
    // QR Code data structure - MUST MATCH what backend expects
    const qrData = JSON.stringify({
        appId: APP_ID,              // backend checks this
        keyId: txId,                // backend uses this to lookup transaction
        keyName: details.name,       // for display purposes
        validFrom: details.validFrom, // ISO 8601 timestamp
        validUntil: details.validUntil // ISO 8601 timestamp
        // NOTE: recipient is NOT in QR - backend fetches it from blockchain
    });

    console.log('='.repeat(60));
    console.log('QR CODE DATA (for manual testing):');
    console.log(qrData);
    console.log('='.repeat(60));

    const qrContainer = document.getElementById('qr-container');
    qrContainer.innerHTML = '';

    // Generate QR Code
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
            <strong>For Testing:</strong> Copy the JSON from browser console and paste in guest.html "Enter Code Manually"
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