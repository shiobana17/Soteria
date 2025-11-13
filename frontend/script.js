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
    const APP_ID = "Soteria_v1.0"; //Needs to be changed when deploy.py is run
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


// ABI Definition for our contract methods
// We define this manually to avoid needing to fetch the abi.json file
const contractMethods = [
    {
        "name": "create_key",
        "args": [
            {"type":"string","name":"key_id"},
            {"type":"address","name":"recipient"},
            {"type":"uint64","name":"valid_from"},
            {"type":"uint64","name":"valid_until"}
        ],
        "returns": {"type":"void"}
    },
    {
        "name": "revoke_key",
        "args": [{"type":"string","name":"key_id"}],
        "returns": {"type":"void"}
    }
];

async function handleCreateKey(e) {
    e.preventDefault();
    if (!userAccount) {
        showAlert('Please connect your wallet first', 'warning');
        return;
    }
    if (APP_ID === 0) {
        showAlert('APP_ID is not set in script.js!', 'danger');
        return;
    }

    const keyName = document.getElementById('key-name').value.trim();
    const recipient = document.getElementById('recipient-wallet').value.trim();
    const startDateInput = document.getElementById('start-date').value;
    const endDateInput = document.getElementById('end-date').value;

    // --- Validation ---
    if (!keyName || !recipient || !startDateInput || !endDateInput) {
        showAlert('All fields are required', 'warning');
        return;
    }
    if (!algosdk.isValidAddress(recipient)) {
        showAlert('Invalid Algorand address', 'danger');
        return;
    }

    // --- Data Preparation ---
    // 1. Generate a unique key_id (Box name)
    // We use a simple composite. A UUID library would be more robust.
    const keyId = `${keyName.replace(/\s+/g, '_')}-${recipient.substring(0, 8)}-${Date.now()}`;
    
    // 2. Convert dates to UNIX timestamps (seconds), which the contract expects
    const validFrom = Math.floor(new Date(startDateInput).getTime() / 1000);
    const validUntil = Math.floor(new Date(endDateInput).getTime() / 1000);

    if (validUntil <= validFrom) {
        showAlert('End time must be after start time', 'danger');
        return;
    }
    if (validFrom < Math.floor(Date.now() / 1000)) {
        showAlert('Start time cannot be in the past', 'danger');
        return;
    }

    showAlert('Creating key on-chain...', 'info', true);
    setAllButtonsDisabled(true);

    try {
        const params = await algoClient.getTransactionParams().do();
        
        // We need to pay for box creation. This covers the 64 bytes.
        // min bal for box = 2500 + (len(key_id) + 64) * 400
        const boxMbr = 2500 + (keyId.length + 64) * 400;
        params.fee = 2 * algosdk.ALGORAND_MIN_TX_FEE; // 1 for app call, 1 for box create
        
        const atc = new algosdk.AtomicTransactionComposer();

        // 1. Payment transaction to fund the Box MBR
        const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            from: userAccount,
            to: algosdk.getApplicationAddress(APP_ID),
            amount: boxMbr,
            suggestedParams: params,
        });

        // 2. Application call to create_key
        atc.addMethodCall({
            appID: APP_ID,
            method: algosdk.getMethodByName(contractMethods, "create_key"),
            sender: userAccount,
            suggestedParams: params,
            signer: algosdk.makeBasicAccountTransactionSigner(devAccount), // Assumes devAccount is the signer
            methodArgs: [keyId, recipient, validFrom, validUntil],
            // We MUST reference the box we are creating
            boxes: [{ appIndex: 0, name: new Uint8Array(Buffer.from(keyId)) }],
            // We group the payment txn with the app call
            txnToSign: paymentTxn
        });

        console.log(`Submitting create_key call for keyId: ${keyId}`);
        const result = await atc.execute(algoClient, 4);
        console.log('Transaction confirmed:', result.txIDs[0]);

        createKeyForm.reset();
        createKeyModal.hide();
        showAlert('Guest key created successfully!', 'success');
        
        // Wait for indexer/node and refresh
        setTimeout(fetchActivityLogs, 2000);

    } catch (err) {
        console.error('Create key failed:', err);
        showAlert(err.message || 'Failed to create key', 'danger');
    } finally {
        setAllButtonsDisabled(false);
    }
}

    // Revoke Guest Key
async function handleRevokeKey(keyId) {
    if (!confirm(`Are you sure you want to revoke this guest key?\n\nID: ${keyId}\n\n⚠️ This action cannot be undone.`)) {
        return;
    }
    if (!userAccount) {
        showAlert('Please connect your wallet first', 'warning');
        return;
    }

    showAlert('Revoking key...', 'info', true);
    setAllButtonsDisabled(true);

    try {
        const params = await algoClient.getTransactionParams().do();
        // Fee for 1 app call
        params.fee = algosdk.ALGORAND_MIN_TX_FEE; 
        
        const atc = new algosdk.AtomicTransactionComposer();

        atc.addMethodCall({
            appID: APP_ID,
            method: algosdk.getMethodByName(contractMethods, "revoke_key"),
            sender: userAccount,
            suggestedParams: params,
            signer: algosdk.makeBasicAccountTransactionSigner(devAccount),
            methodArgs: [keyId],
            // We MUST reference the box we are modifying
            boxes: [{ appIndex: 0, name: new Uint8Array(Buffer.from(keyId)) }]
        });

        console.log(`Submitting revoke_key call for keyId: ${keyId}`);
        const result = await atc.execute(algoClient, 4);
        console.log('Transaction confirmed:', result.txIDs[0]);

        showAlert('✅ Guest key revoked successfully', 'warning');
        
        // Wait for indexer/node and refresh
        setTimeout(fetchActivityLogs, 2000);

    } catch (err) {
        console.error('Revoke failed:', err);
        showAlert(err.message || 'Failed to revoke key', 'danger');
    } finally {
        setAllButtonsDisabled(false);
    }
}


    // Fetch Activity Logs
// Helper function to parse 8-byte Uint64 from box data
function parseUint64(bytes, offset) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return view.getBigUint64(offset, false); // false for big-endian
}
// Helper function to parse 32-byte address from box data
function parseAddress(bytes, offset) {
    const addressBytes = bytes.slice(offset, offset + 32);
    return algosdk.encodeAddress(addressBytes);
}

// Stores parsed box data
let allKeys = [];

async function fetchActivityLogs() {
    if (!userAccount) {
        console.error('Cannot fetch logs: userAccount not set');
        return;
    }
     if (APP_ID === 0) {
        logContainer.innerHTML = `<div class="text-center mt-5"><p class="text-danger">APP_ID is not set in script.js!</p></div>`;
        return;
    }

    console.log('Fetching contract boxes for App ID:', APP_ID);

    logContainer.innerHTML = `
        <div class="text-center mt-5">
            <div class="spinner-border text-info" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <p class="text-secondary mt-3">Loading keys from contract boxes...</p>
        </div>`;

    try {
        const response = await algoClient.getApplicationBoxes(APP_ID).do();
        const boxNames = response.boxes.map(box => box.name);
        console.log(`Found ${boxNames.length} key boxes`);

        allKeys = []; // Clear previous state
        
        for (const boxNameBytes of boxNames) {
            const boxName = new TextDecoder().decode(boxNameBytes);
            try {
                const boxValue = await algoClient.getApplicationBoxByName(APP_ID, boxNameBytes).do();
                const boxBytes = new Uint8Array(Buffer.from(boxValue.value, 'base64'));

                // Parse the box data according to smartContract/contract.py
                const recipient = parseAddress(boxBytes, 0);
                const validFrom = parseUint64(boxBytes, 32);
                const validUntil = parseUint64(boxBytes, 40);
                const status = parseUint64(boxBytes, 48); // 1=ACTIVE, 0=REVOKED

                allKeys.push({
                    id: boxName,
                    name: boxName.split('-')[0].replace(/_/g, ' '), // Recreate name from keyId
                    recipient: recipient,
                    validFrom: Number(validFrom) * 1000, // Convert to JS ms
                    validUntil: Number(validUntil) * 1000, // Convert to JS ms
                    status: Number(status)
                });
            } catch (e) {
                 console.warn(`Failed to parse box '${boxName}':`, e);
            }
        }
        
        console.log(`Successfully parsed ${allKeys.length} keys`);
        
        // TODO: The new contract doesn't store general activity logs (lock/unlock)
        // We will just render the keys for now. The activity log will be empty.
        renderLogsAndKeys(allKeys);

    } catch (err) {
        console.error('Failed to fetch logs:', err);
        logContainer.innerHTML = `
            <div class="text-center mt-5">
                <i class="bi bi-exclamation-triangle text-danger" style="font-size: 3rem;"></i>
                <p class="text-danger mt-3">Failed to load contract boxes</p>
                <p class="text-secondary small">${err.message}</p>
                <button class="btn btn-sm btn-outline-info" onclick="location.reload()">Retry</button>
            </div>`;
    }
}

// Render Logs and Keys
function renderLogsAndKeys(keys) {
    console.log('Rendering', keys.length, 'guest keys');
    
    // Render Guest Keys
    if (keys.length > 0) {
        // Sort keys by creation time (newest first), inferred from timestamp in keyId
        keys.sort((a, b) => {
            const timeA = a.id.split('-').pop() || 0;
            const timeB = b.id.split('-').pop() || 0;
            return timeB - timeA;
        });

        guestKeyList.innerHTML = keys.map(createGuestKeyElement).join('');
    } else {
        guestKeyList.innerHTML = '<p class="text-secondary text-center py-4">No guest keys created yet</p>';
    }

    // Render Activity Logs
    // NOTE: The new contract doesn't store a general activity log (like lock/unlock).
    // We can either build one from the key data or leave it empty.
    // For now, we'll show a "no activity" message.
    console.log('Rendering 0 activity log entries (not supported by contract)');
    
    logContainer.innerHTML = `
        <div class="text-center" style="margin-top: 20vh;">
            <i class="bi bi-inbox" style="font-size: 3rem; opacity: 0.3;"></i>
            <p class="text-secondary mt-3">No activity log found</p>
            <p class="text-secondary small">Key management is now handled by contract boxes.</p>
        </div>`;
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
function createGuestKeyElement(key) {
    // key object: { id, name, recipient, validFrom, validUntil, status }
    
    const now = Date.now();
    const isRevoked = key.status === 0;
    const isExpired = now > key.validUntil;
    
    // Status badge
    let statusBadge = '';
    if (isRevoked) {
        statusBadge = '<span class="badge bg-danger ms-2">Revoked</span>';
    } else if (isExpired) {
        statusBadge = '<span class="badge bg-secondary ms-2">Expired</span>';
    } else {
        statusBadge = '<span class="badge bg-success ms-2">Active</span>';
    }
    
    const shortRecipient = `${key.recipient.substring(0, 8)}...${key.recipient.slice(-6)}`;
    
    const startDate = new Date(key.validFrom).toLocaleString();
    const endDate = new Date(key.validUntil).toLocaleString();

    return `
        <div class="guest-key-item">
            <div class="d-flex justify-content-between align-items-center">
                <div class="flex-grow-1">
                    <p class="mb-1 fw-semibold">
                        <i class="bi bi-key me-1"></i>${key.name}${statusBadge}
                    </p>
                    <p class="mb-0 small text-secondary">
                        <i class="bi bi-person me-1"></i>${shortRecipient}
                    </p>
                    <p class="mb-0 small text-secondary">
                        <i class="bi bi-calendar-range me-1"></i>${startDate} → ${endDate}
                    </p>
                    <p class="mb-0 small text-secondary text-truncate" style="max-width: 200px;">
                        <i class="bi bi-fingerprint me-1"></i>${key.id}
                    </p>
                </div>
                <div class="btn-group">
                    <button class="btn btn-sm btn-outline-info" 
                            onclick="window.showQRCode('${key.id}')" 
                            ${isRevoked || isExpired ? 'disabled' : ''}
                            title="View QR Code">
                        <i class="bi bi-qr-code"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" 
                            onclick="window.revokeGuestKey('${key.id}')" 
                            ${isRevoked || isExpired ? 'disabled' : ''}
                            title="Revoke Access">
                        <i class="bi bi-x-circle"></i>
                    </button>
                </div>
            </div>
        </div>`;
}

// Display QR Code - FIXED TO MATCH BACKEND EXPECTATIONS
function displayQRCode(keyId) {
    const key = allKeys.find(k => k.id === keyId);
    if (!key) {
        console.error("Could not find key to display QR code for:", keyId);
        return;
    }
    
    // QR Code data structure - MUST MATCH what backend expects
    const qrData = JSON.stringify({
        appId: APP_ID,     // The numeric App ID
        keyId: key.id,     // The string keyId (Box name)
        keyName: key.name  // For display on the scanner side
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
    const startDate = new Date(key.validFrom).toLocaleString();
    const endDate = new Date(key.validUntil).toLocaleString();
    
    // We can estimate creation date from the keyId timestamp
    const createdDate = new Date(parseInt(key.id.split('-').pop() || 0)).toLocaleString();

    document.getElementById('qr-key-details').innerHTML = `
        <p class="mb-2"><strong><i class="bi bi-tag me-2"></i>Key Name:</strong> ${key.name}</p>
        <p class="mb-2 text-break"><strong><i class="bi bi-person me-2"></i>Recipient:</strong> ${key.recipient}</p>
        <p class="mb-2"><strong><i class="bi bi-calendar-check me-2"></i>Valid From:</strong> ${startDate}</p>
        <p class="mb-2"><strong><i class="bi bi-calendar-x me-2"></i>Valid Until:</strong> ${endDate}</p>
        <p class="mb-2 small text-secondary"><strong><i class="bi bi-clock-history me-2"></i>Created:</strong> ${createdDate} (Est.)</p>
        <p class="mb-0 small text-secondary text-truncate"><strong><i class="bi bi-fingerprint me-2"></i>Key ID:</strong> ${key.id}</p>
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

    console.log('Soteria Dashboard v' + APP_VERSION + ' initialized');
    console.log('App ID:', APP_ID);
    console.log('Connected to Algorand TestNet');
});