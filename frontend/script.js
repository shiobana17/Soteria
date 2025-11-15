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

    // Load configuration
    let APP_ID = 0;
    let APP_ADDRESS = "";
    
    if (typeof SOTERIA_CONFIG !== 'undefined') {
        APP_ID = SOTERIA_CONFIG.APP_ID;
        APP_ADDRESS = SOTERIA_CONFIG.APP_ADDRESS;
        console.log('✅ Loaded config from config.js');
        console.log('   App ID:', APP_ID);
        console.log('   App Address:', APP_ADDRESS);
    } else {
        console.error('❌ SOTERIA_CONFIG not found!');
        alert('Configuration not loaded! Please run deploy.py first.');
        return;
    }
    
    // Algorand Setup
    const peraWallet = new PeraWalletConnect();
    const algod_token = "";
    const algod_address = SOTERIA_CONFIG.ALGOD_SERVER || "https://testnet-api.algonode.cloud";
    const algoClient = new algosdk.Algodv2(algod_token, algod_address, '');

    const indexer_token = "";
    const indexer_address = SOTERIA_CONFIG.INDEXER_SERVER || "https://testnet-idx.algonode.cloud";
    const indexerClient = new algosdk.Indexer(indexer_token, indexer_address, '');
    
    const APP_VERSION = "1.0.0";

    // AUTO-GENERATE OR LOAD DEPLOYER ACCOUNT
    let devAccount = null;
    const storedAccount = localStorage.getItem('soteria_dev_account');

    // First, try to load the deployer account from deployer_account.txt
    // Check if we have a saved deployer mnemonic
    const deployerMnemonic = localStorage.getItem('soteria_deployer_mnemonic');
    
    if (deployerMnemonic) {
        // Use the deployer account
        try {
            devAccount = algosdk.mnemonicToSecretKey(deployerMnemonic);
            console.log('✅ Deployer account loaded:', devAccount.addr);
        } catch (e) {
            console.error('Failed to load deployer account:', e);
        }
    }
    
    if (!devAccount && storedAccount) {
        // Use existing dev account
        devAccount = JSON.parse(storedAccount);
        devAccount.sk = new Uint8Array(devAccount.sk);
        console.log('✅ Dev account loaded:', devAccount.addr);
        console.warn('⚠️  This account may not be the contract creator!');
        console.warn('   If you get "assert failed" errors, use the deployer account.');
    }
    
    if (!devAccount) {
        // Generate new account
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
        console.warn('⚠️  This account is NOT the contract creator!');
        console.warn('   You need to use the account that deployed the contract.');
        console.warn('   Check deployer_account.txt for the correct mnemonic.');
        
        alert(`New dev account created!\n\nAddress: ${devAccount.addr}\n\n⚠️ WARNING: This is not the contract creator!\n\nTo create keys, you need the deployer account.\nCheck deployer_account.txt or console for instructions.`);
    }

    // State
    let userAccount = null;
    let isLocked = true;
    let allKeys = [];
    let activityLog = []; // Track lock/unlock events

    devAccount.sk = new Uint8Array(devAccount.sk);
    userAccount = devAccount.addr;
    console.log('Auto-connected with dev account:', userAccount);

    console.log("ITR"); // Signature

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
    unlockBtn.addEventListener('click', handleUnlock);
    lockBtn.addEventListener('click', handleLock);

    // Lock/Unlock Handlers
    async function handleUnlock() {
        if (!userAccount) {
            showAlert('Please connect your wallet first', 'warning');
            return;
        }
        
        if (!devAccount || !devAccount.sk) {
            showAlert('Deployer account not configured', 'danger');
            return;
        }

        showAlert('Unlocking door...', 'info', true);
        setAllButtonsDisabled(true);

        try {
            // Check account balance first
            const accountInfo = await algoClient.accountInformation(userAccount).do();
            console.log('Account balance:', accountInfo.amount / 1000000, 'ALGO');
            
            if (accountInfo.amount < 1000) {
                throw new Error('Insufficient balance. Need at least 0.001 ALGO for transaction fee.');
            }
            
            // Create transaction to log unlock to blockchain
            const params = await algoClient.getTransactionParams().do();
            
            const note = JSON.stringify({
                app_id: APP_ID,
                action: 'owner_unlock',
                timestamp: new Date().toISOString()
            });
            
            const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
                from: userAccount,
                to: APP_ADDRESS,
                amount: 0,
                note: new Uint8Array(Buffer.from(note)),
                suggestedParams: params
            });
            
            // Sign and submit
            const signedTxn = txn.signTxn(devAccount.sk);
            const txResponse = await algoClient.sendRawTransaction(signedTxn).do();
            
            console.log('✅ Unlock transaction sent:', txResponse.txId);
            console.log('View at: https://testnet.algoexplorer.io/tx/' + txResponse.txId);
            
            // Update UI
            isLocked = false;
            updateLockUI();
            updateLockButtonStates();
            showAlert('✅ Door unlocked! Transaction: ' + txResponse.txId.substring(0, 8) + '...', 'success');
            
            // Wait for confirmation then refresh
            setTimeout(() => {
                console.log('Refreshing activity logs...');
                fetchActivityLogs();
            }, 3000);
            
        } catch (err) {
            console.error('Unlock failed:', err);
            showAlert('Failed to unlock: ' + err.message, 'danger');
        } finally {
            setAllButtonsDisabled(false);
        }
    }

    async function handleLock() {
        if (!userAccount) {
            showAlert('Please connect your wallet first', 'warning');
            return;
        }
        
        if (!devAccount || !devAccount.sk) {
            showAlert('Deployer account not configured', 'danger');
            return;
        }

        showAlert('Locking door...', 'info', true);
        setAllButtonsDisabled(true);

        try {
            // Check account balance first
            const accountInfo = await algoClient.accountInformation(userAccount).do();
            console.log('Account balance:', accountInfo.amount / 1000000, 'ALGO');
            
            if (accountInfo.amount < 1000) {
                throw new Error('Insufficient balance. Need at least 0.001 ALGO for transaction fee.');
            }
            
            // Create transaction to log lock to blockchain
            const params = await algoClient.getTransactionParams().do();
            
            const note = JSON.stringify({
                app_id: APP_ID,
                action: 'owner_lock',
                timestamp: new Date().toISOString()
            });
            
            const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
                from: userAccount,
                to: APP_ADDRESS,
                amount: 0,
                note: new Uint8Array(Buffer.from(note)),
                suggestedParams: params
            });
            
            // Sign and submit
            const signedTxn = txn.signTxn(devAccount.sk);
            const txResponse = await algoClient.sendRawTransaction(signedTxn).do();
            
            console.log('✅ Lock transaction sent:', txResponse.txId);
            console.log('View at: https://testnet.algoscan.app/tx/' + txResponse.txId);
            
            // Update UI
            isLocked = true;
            updateLockUI();
            updateLockButtonStates();
            showAlert('✅ Door locked! Transaction: ' + txResponse.txId.substring(0, 8) + '...', 'success');
            
            // Wait for confirmation then refresh
            setTimeout(() => {
                console.log('Refreshing activity logs...');
                fetchActivityLogs();
            }, 3000);
            
        } catch (err) {
            console.error('Lock failed:', err);
            showAlert('Failed to lock: ' + err.message, 'danger');
        } finally {
            setAllButtonsDisabled(false);
        }
    }
    
    // Add activity to log (for immediate UI feedback)
    function addActivityLog(action, description) {
        console.log('Adding activity log:', action, description);
        
        activityLog.unshift({
            action: action,
            description: description,
            timestamp: new Date().toISOString(),
            user: userAccount
        });
        
        console.log('Activity log now has', activityLog.length, 'events');
        
        // Keep only last 20 events
        if (activityLog.length > 20) {
            activityLog = activityLog.slice(0, 20);
        }
        
        // Re-render
        renderLogsAndKeys(allKeys);
    }

    // Wallet Connection
    function handleConnectWallet() {
        if (devAccount) {
            userAccount = devAccount.addr;
            updateUIForConnectedState();
            showAlert('Dev wallet connected!', 'success');
            return;
        }
        
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
        
        if (logPlaceholder) {
            logPlaceholder.style.display = 'none';
        }
        
        console.log('Fetching keys from contract for:', userAccount);
        fetchActivityLogs();
    }

    // ABI Contract Definition
    const contractInterface = new algosdk.ABIContract({
        name: "Soteria",
        methods: [
            {
                name: "create_key",
                args: [
                    { type: "string", name: "key_id" },
                    { type: "address", name: "recipient" },
                    { type: "uint64", name: "valid_from" },
                    { type: "uint64", name: "valid_until" }
                ],
                returns: { type: "void" }
            },
            {
                name: "revoke_key",
                args: [{ type: "string", name: "key_id" }],
                returns: { type: "void" }
            },
            {
                name: "verify_access",
                args: [{ type: "string", name: "key_id" }],
                returns: { type: "string" }
            }
        ]
    });

    async function handleCreateKey(e) {
        e.preventDefault();
        if (!userAccount) {
            showAlert('Please connect your wallet first', 'warning');
            return;
        }
        if (APP_ID === 0) {
            showAlert('APP_ID is not set! Please run deploy.py', 'danger');
            return;
        }

        const keyName = document.getElementById('key-name').value.trim();
        const recipient = document.getElementById('recipient-wallet').value.trim();
        const startDateInput = document.getElementById('start-date').value;
        const endDateInput = document.getElementById('end-date').value;

        // Validation
        if (!keyName || !recipient || !startDateInput || !endDateInput) {
            showAlert('All fields are required', 'warning');
            return;
        }
        if (!algosdk.isValidAddress(recipient)) {
            showAlert('Invalid Algorand address', 'danger');
            return;
        }

        // Generate unique key_id
        const keyId = `${keyName.replace(/\s+/g, '_')}-${recipient.substring(0, 8)}-${Date.now()}`;
        
        // Convert dates to UNIX timestamps (seconds)
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
            
            // Calculate box MBR
            const boxMbr = 2500 + (keyId.length + 64) * 400;
            params.fee = 2 * algosdk.ALGORAND_MIN_TX_FEE;
            params.flatFee = true;
            
            const atc = new algosdk.AtomicTransactionComposer();

            // 1. Payment to fund the box
            const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
                from: userAccount,
                to: APP_ADDRESS,
                amount: boxMbr,
                suggestedParams: params,
            });

            atc.addTransaction({ txn: paymentTxn, signer: algosdk.makeBasicAccountTransactionSigner(devAccount) });

            // 2. Application call to create_key
            atc.addMethodCall({
                appID: APP_ID,
                method: contractInterface.getMethodByName("create_key"),
                sender: userAccount,
                suggestedParams: params,
                signer: algosdk.makeBasicAccountTransactionSigner(devAccount),
                methodArgs: [keyId, recipient, validFrom, validUntil],
                boxes: [{ appIndex: 0, name: new Uint8Array(Buffer.from(keyId)) }]
            });

            console.log(`Submitting create_key call for keyId: ${keyId}`);
            const result = await atc.execute(algoClient, 4);
            console.log('Transaction confirmed:', result.txIDs);

            createKeyForm.reset();
            createKeyModal.hide();
            showAlert('✅ Guest key created successfully!', 'success');
            
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
        if (!confirm(`Revoke this guest key?\n\nID: ${keyId}\n\n⚠️ This action cannot be undone.`)) {
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
            params.fee = algosdk.ALGORAND_MIN_TX_FEE;
            params.flatFee = true;
            
            const atc = new algosdk.AtomicTransactionComposer();

            atc.addMethodCall({
                appID: APP_ID,
                method: contractInterface.getMethodByName("revoke_key"),
                sender: userAccount,
                suggestedParams: params,
                signer: algosdk.makeBasicAccountTransactionSigner(devAccount),
                methodArgs: [keyId],
                boxes: [{ appIndex: 0, name: new Uint8Array(Buffer.from(keyId)) }]
            });

            console.log(`Submitting revoke_key call for keyId: ${keyId}`);
            const result = await atc.execute(algoClient, 4);
            console.log('Transaction confirmed:', result.txIDs[0]);

            showAlert('✅ Guest key revoked successfully', 'warning');
            
            setTimeout(fetchActivityLogs, 2000);

        } catch (err) {
            console.error('Revoke failed:', err);
            showAlert(err.message || 'Failed to revoke key', 'danger');
        } finally {
            setAllButtonsDisabled(false);
        }
    }

    // Helper to parse Uint64 from box data
    function parseUint64(bytes, offset) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return view.getBigUint64(offset, false);
    }

    // Helper to parse address from box data
    function parseAddress(bytes, offset) {
        const addressBytes = bytes.slice(offset, offset + 32);
        return algosdk.encodeAddress(addressBytes);
    }

    async function fetchActivityLogs() {
        if (!userAccount) {
            console.error('Cannot fetch logs: userAccount not set');
            return;
        }
        if (APP_ID === 0) {
            logContainer.innerHTML = `<div class="text-center mt-5"><p class="text-danger">APP_ID is not set! Please run deploy.py</p></div>`;
            return;
        }

        console.log('Fetching contract boxes and transactions for App ID:', APP_ID);

        logContainer.innerHTML = `
            <div class="text-center mt-5">
                <div class="spinner-border text-info" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <p class="text-secondary mt-3">Loading activity from blockchain...</p>
            </div>`;

        try {
            // Fetch boxes (guest keys)
            const response = await algoClient.getApplicationBoxes(APP_ID).do();
            const boxNames = response.boxes.map(box => box.name);
            console.log(`Found ${boxNames.length} key boxes`);

            allKeys = [];
            
            for (const boxNameBytes of boxNames) {
                const boxName = new TextDecoder().decode(boxNameBytes);
                try {
                    const boxValue = await algoClient.getApplicationBoxByName(APP_ID, boxNameBytes).do();
                    const boxBytes = new Uint8Array(Buffer.from(boxValue.value, 'base64'));

                    const recipient = parseAddress(boxBytes, 0);
                    const validFrom = parseUint64(boxBytes, 32);
                    const validUntil = parseUint64(boxBytes, 40);
                    const status = parseUint64(boxBytes, 48);

                    allKeys.push({
                        id: boxName,
                        name: boxName.split('-')[0].replace(/_/g, ' '),
                        recipient: recipient,
                        validFrom: Number(validFrom) * 1000,
                        validUntil: Number(validUntil) * 1000,
                        status: Number(status)
                    });
                } catch (e) {
                    console.warn(`Failed to parse box '${boxName}':`, e);
                }
            }
            
            console.log(`Successfully parsed ${allKeys.length} keys`);
            
            // Fetch guest activity transactions to the contract address
            console.log('Fetching guest activity transactions...');
            
            // Wait a moment for indexer to catch up
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const txResponse = await indexerClient.searchForTransactions()
                .address(APP_ADDRESS)
                .txType('pay')
                .limit(100)
                .do();
            
            console.log('Transaction search response:', txResponse);
            console.log('Found', txResponse.transactions?.length || 0, 'payment transactions');
            
            // Parse guest lock/unlock transactions
            const guestActivities = [];
            if (txResponse.transactions) {
                for (const tx of txResponse.transactions) {
                    console.log('Checking transaction:', tx.id, 'Note:', tx.note);
                    
                    if (tx.note) {
                        try {
                            const noteStr = new TextDecoder().decode(Buffer.from(tx.note, 'base64'));
                            console.log('Note decoded:', noteStr);
                            const noteData = JSON.parse(noteStr);
                            
                            console.log('Note data:', noteData);
                            
                            if (noteData.app_id === APP_ID && 
                                (noteData.action === 'guest_unlock' || 
                                 noteData.action === 'guest_lock' ||
                                 noteData.action === 'owner_unlock' ||
                                 noteData.action === 'owner_lock')) {
                                console.log('✅ Found activity:', noteData.action);
                                
                                // Determine the most recent lock state
                                if (noteData.action === 'guest_unlock' || noteData.action === 'owner_unlock') {
                                    isLocked = false;
                                } else if (noteData.action === 'guest_lock' || noteData.action === 'owner_lock') {
                                    isLocked = true;
                                }
                                
                                guestActivities.push({
                                    id: tx.id,
                                    action: noteData.action,
                                    keyName: noteData.keyName || 'Owner',
                                    keyId: noteData.keyId,
                                    timestamp: noteData.timestamp || new Date(tx['round-time'] * 1000).toISOString(),
                                    confirmedRound: tx['confirmed-round']
                                });
                            }
                        } catch (e) {
                            console.warn('Failed to parse transaction note:', e);
                        }
                    }
                }
            }
            
            console.log(`Found ${guestActivities.length} activity events`);
            
            // Update door UI based on latest state
            updateLockUI();
            updateLockButtonStates();
            
            // Sort and show activities
            guestActivities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            renderLogsAndKeys(allKeys, guestActivities.slice(0, 50)); // Show last 50 events

        } catch (err) {
            console.error('Failed to fetch logs:', err);
            logContainer.innerHTML = `
                <div class="text-center mt-5">
                    <i class="bi bi-exclamation-triangle text-danger" style="font-size: 3rem;"></i>
                    <p class="text-danger mt-3">Failed to load activity</p>
                    <p class="text-secondary small">${err.message}</p>
                    <button class="btn btn-sm btn-outline-info" onclick="location.reload()">Retry</button>
                </div>`;
        }
    }

    function renderLogsAndKeys(keys, activities = []) {
        console.log('Rendering', keys.length, 'guest keys and', activities.length, 'activity events');
        
        // Render Guest Keys
        if (keys.length > 0) {
            keys.sort((a, b) => {
                const timeA = parseInt(a.id.split('-').pop()) || 0;
                const timeB = parseInt(b.id.split('-').pop()) || 0;
                return timeB - timeA;
            });

            guestKeyList.innerHTML = keys.map(createGuestKeyElement).join('');
        } else {
            guestKeyList.innerHTML = '<p class="text-secondary text-center py-4">No guest keys created yet</p>';
        }

        // Render Activity Logs (including local and blockchain events)
        if (activities.length > 0) {
            logContainer.innerHTML = activities.map(event => {
                // Check if it's a local event or blockchain event
                if (event.id && event.confirmedRound) {
                    return createBlockchainActivityElement(event);
                } else {
                    return createActivityLogElement(event);
                }
            }).join('');
        } else {
            logContainer.innerHTML = `
                <div class="text-center" style="margin-top: 20vh;">
                    <i class="bi bi-inbox" style="font-size: 3rem; opacity: 0.3;"></i>
                    <p class="text-secondary mt-3">No recent activity</p>
                    <p class="text-secondary small">${keys.length} active key${keys.length !== 1 ? 's' : ''}</p>
                </div>`;
        }
    }
    
    // Create blockchain activity element (all lock/unlock events)
    function createBlockchainActivityElement(event) {
        const timestamp = new Date(event.timestamp);
        const timeStr = timestamp.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        let icon, color, title, subtitle;
        
        if (event.action === 'guest_unlock') {
            icon = 'unlock-fill';
            color = 'success';
            title = '🔓 Guest Unlocked Door';
            subtitle = `Guest: ${event.keyName}`;
        } else if (event.action === 'guest_lock') {
            icon = 'lock-fill';
            color = 'danger';
            title = '🔒 Guest Locked Door';
            subtitle = `Guest: ${event.keyName}`;
        } else if (event.action === 'owner_unlock') {
            icon = 'unlock-fill';
            color = 'success';
            title = '🔓 Owner Unlocked Door';
            subtitle = 'Manual control by owner';
        } else if (event.action === 'owner_lock') {
            icon = 'lock-fill';
            color = 'danger';
            title = '🔒 Owner Locked Door';
            subtitle = 'Manual control by owner';
        } else {
            icon = 'info-circle-fill';
            color = 'info';
            title = event.action;
            subtitle = event.keyName;
        }
        
        return `
            <div class="log-item">
                <div class="d-flex align-items-center gap-3">
                    <i class="bi bi-${icon} text-${color} fs-3"></i>
                    <div class="flex-grow-1">
                        <p class="mb-1 fw-semibold">${title}</p>
                        <p class="mb-0 small text-secondary">${subtitle}</p>
                        <p class="mb-0 small text-secondary">
                            <i class="bi bi-clock me-1"></i>${timeStr}
                        </p>
                    </div>
                    <a href="https://testnet.algoexplorer.io/tx/${event.id}" 
                       target="_blank" 
                       rel="noopener noreferrer" 
                       class="btn btn-sm btn-outline-secondary"
                       title="View on AlgoExplorer">
                        <i class="bi bi-box-arrow-up-right"></i>
                    </a>
                </div>
            </div>`;
    }
    
    // Create activity log element
    function createActivityLogElement(event) {
        const timestamp = new Date(event.timestamp);
        const timeStr = timestamp.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        let icon, color, title;
        
        if (event.action === 'unlock') {
            icon = 'unlock-fill';
            color = 'success';
            title = '🔓 Door Unlocked';
        } else if (event.action === 'lock') {
            icon = 'lock-fill';
            color = 'danger';
            title = '🔒 Door Locked';
        } else {
            icon = 'info-circle-fill';
            color = 'info';
            title = event.action;
        }
        
        return `
            <div class="log-item">
                <div class="d-flex align-items-center gap-3">
                    <i class="bi bi-${icon} text-${color} fs-3"></i>
                    <div class="flex-grow-1">
                        <p class="mb-1 fw-semibold">${title}</p>
                        <p class="mb-0 small text-secondary">${event.description}</p>
                        <p class="mb-0 small text-secondary">
                            <i class="bi bi-clock me-1"></i>${timeStr}
                        </p>
                    </div>
                </div>
            </div>`;
    }

    function createGuestKeyElement(key) {
        const now = Date.now();
        const isRevoked = key.status === 0;
        const isExpired = now > key.validUntil;
        
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

    function displayQRCode(keyId) {
        const key = allKeys.find(k => k.id === keyId);
        if (!key) {
            console.error("Key not found:", keyId);
            return;
        }
        
        // QR Code data - MUST MATCH backend expectations
        const qrData = JSON.stringify({
            appId: APP_ID,
            keyId: key.id,
            keyName: key.name
        });

        console.log('='.repeat(60));
        console.log('QR CODE DATA (for testing):');
        console.log(qrData);
        console.log('='.repeat(60));

        const qrContainer = document.getElementById('qr-container');
        qrContainer.innerHTML = '';

        new QRCode(qrContainer, {
            text: qrData,
            width: 256,
            height: 256,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });

        const startDate = new Date(key.validFrom).toLocaleString();
        const endDate = new Date(key.validUntil).toLocaleString();
        const createdDate = new Date(parseInt(key.id.split('-').pop()) || 0).toLocaleString();

        document.getElementById('qr-key-details').innerHTML = `
            <p class="mb-2"><strong><i class="bi bi-tag me-2"></i>Key Name:</strong> ${key.name}</p>
            <p class="mb-2 text-break"><strong><i class="bi bi-person me-2"></i>Recipient:</strong> ${key.recipient}</p>
            <p class="mb-2"><strong><i class="bi bi-calendar-check me-2"></i>Valid From:</strong> ${startDate}</p>
            <p class="mb-2"><strong><i class="bi bi-calendar-x me-2"></i>Valid Until:</strong> ${endDate}</p>
            <p class="mb-2 small text-secondary"><strong><i class="bi bi-clock-history me-2"></i>Created:</strong> ${createdDate}</p>
            <p class="mb-0 small text-secondary text-truncate"><strong><i class="bi bi-fingerprint me-2"></i>Key ID:</strong> ${key.id}</p>
            <div class="alert alert-info mt-3 mb-0 small">
                <i class="bi bi-info-circle me-2"></i>
                Scan with guest.html or copy JSON from console
            </div>
        `;

        qrCodeModal.show();
    }

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

    // Global functions
    window.showQRCode = displayQRCode;
    window.revokeGuestKey = handleRevokeKey;
    window.refreshLogs = fetchActivityLogs;
    window.disconnectWallet = async () => {
        await peraWallet.disconnect();
        userAccount = null;
        location.reload();
    };
    
    // Helper to set deployer account mnemonic
    window.setDeployerAccount = (mnemonic) => {
        try {
            const account = algosdk.mnemonicToSecretKey(mnemonic);
            localStorage.setItem('soteria_deployer_mnemonic', mnemonic);
            console.log('✅ Deployer account saved:', account.addr);
            alert(`Deployer account saved!\n\nAddress: ${account.addr}\n\nReload the page to use this account.`);
        } catch (e) {
            console.error('Invalid mnemonic:', e);
            alert('Invalid mnemonic! Make sure you copied all 25 words correctly.');
        }
    };
    
    // Show instructions if not using deployer account
    if (!deployerMnemonic) {
        console.log('\n' + '='.repeat(60));
        console.log('⚠️  IMPORTANT: TO CREATE KEYS, USE DEPLOYER ACCOUNT');
        console.log('='.repeat(60));
        console.log('The contract creator account is the only one that can create keys.');
        console.log('\nTo set the deployer account, run this in console:');
        console.log('  setDeployerAccount("your 25 word mnemonic here")');
        console.log('\nFind your mnemonic in: deployer_account.txt');
        console.log('='.repeat(60) + '\n');
    }

    console.log('Soteria Dashboard v' + APP_VERSION + ' initialized');
    console.log('App ID:', APP_ID);
    console.log('Connected to Algorand TestNet');
});