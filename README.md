# 🔐 Soteria - Blockchain Smart Lock System

[![Algorand](https://img.shields.io/badge/Algorand-TestNet-blue)](https://testnet.algoexplorer.io/application/749658795)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![Java 11+](https://img.shields.io/badge/java-11+-orange.svg)](https://adoptium.net/)

**Soteria** is a decentralized smart lock access control system powered by Algorand blockchain smart contracts. It enables property owners to create time-limited, revocable access keys for guests, with all access events logged immutably on-chain.

## 🌟 Features

- **🔑 Smart Contract-Based Access Keys**: Guest keys stored in Algorand box storage
- **⏰ Time-Based Access Control**: Automatically enforced by blockchain timestamps
- **🚫 Instant Revocation**: Owners can revoke access immediately
- **📝 Immutable Audit Trail**: All door access events logged on blockchain
- **🌐 Decentralized**: No central server - all logic in smart contract
- **🔒 Tamper-Proof**: Keys cannot be forged or modified

## 📋 Table of Contents

- [Architecture](#architecture)
- [Smart Contract](#smart-contract)
- [Setup & Installation](#setup--installation)
- [Usage](#usage)
- [Deployed Contracts](#deployed-contracts)
- [Contributing](#contributing)

## 🏗️ Architecture

```
┌────────────────────────────────────────────┐
│         Algorand Blockchain (TestNet)      │
│                                            │
│  ┌───────────────────────────────────────┐ │
│  │   Soteria Smart Contract              │ │
│  │   App ID: 749658795                   │ │
│  │                                       │ │
│  │   Methods:                            │ │
│  │   • create_key(key_id, recipient,     │ │
│  │               valid_from, valid_until)│ │
│  │   • revoke_key(key_id)                │ │
│  │   • verify_access(key_id) → string    │ │
│  │                                       │ │
│  │   Storage:                            │ │
│  │   • Box Storage (guest keys)          │ │
│  └───────────────────────────────────────┘ │
└────────────────────────────────────────────┘
         ▲                          ▲
         │                          │
    ┌────┴─────┐              ┌────┴───────┐
    │  Owner   │              │  Guest     │
    │ Dashboard│              │  Portal    │
    │          │              │            │
    │ • Create │              │ • Scan QR  │
    │   keys   │              │ • Verify   │
    │ • Revoke │              │ • Lock/    │
    │ • Monitor│              │   Unlock   │
    └──────────┘              └────────────┘
         │                          │
    ┌────┴──────────────────────────┴────┐
    │     Backend (Java)                 │
    │  • Physical lock control           │
    │  • Access logging                  │
    │  • Hardware integration            │
    └────────────────────────────────────┘
```

### Components

1. **Smart Contract (PyTeal)**: Core access control logic on Algorand
2. **Frontend (HTML/JS)**: Owner dashboard and guest portal
3. **Backend (Java)**: Hardware integration for physical locks eventually
4. **Box Storage**: On-chain key-value storage for guest keys

## 🔐 Smart Contract

The Soteria smart contract is written in PyTeal and deployed on Algorand TestNet.

**Contract Address**: `GWWCEG6OYN2Q7R4G2LHKWC3KNQA44RTYCZA5ROPR2KHEEGJ3HT6NZOMRZE`  
**App ID**: `749658795`

### Methods

#### `create_key(key_id, recipient, valid_from, valid_until)`
Creates a new guest access key stored in box storage.
- **Access**: Owner only (creator address)
- **Parameters**:
  - `key_id` (string): Unique identifier for the key
  - `recipient` (address): Algorand address of the guest
  - `valid_from` (uint64): Unix timestamp when access begins
  - `valid_until` (uint64): Unix timestamp when access expires
- **Storage**: Creates a 64-byte box with key data

#### `revoke_key(key_id)`
Revokes an existing guest key by setting status to 0.
- **Access**: Owner only
- **Parameters**: `key_id` (string)

#### `verify_access(key_id) → string`
Verifies if a key is valid for current access.
- **Access**: Read-only (anyone can call)
- **Returns**: `"GRANTED"`, `"DENIED_REVOKED"`, `"DENIED_EXPIRED"`, or `"DENIED_NOT_YET_VALID"`
- **Checks**:
  1. Key exists in box storage
  2. Status is ACTIVE (not revoked)
  3. Current blockchain time is within valid period

## 🚀 Setup & Installation

### Prerequisites

- **Python 3.8+** (for smart contract)
- **Java 11+** and Maven (for backend)
- **Algorand account** with TestNet ALGO

### 1. Clone the Repository

```bash
git clone https://github.com/shiobana17/Soteria.git
cd Soteria
```

### 2. Install Python Dependencies

```bash
cd smartContract
pip install -r requirements.txt
```

### 3. Compile Smart Contract

```bash
python contract.py
```

This generates `approval.teal`, `clear.teal`, and `abi.json` in `smartContract/artifacts/`.

### 4. Deploy Smart Contract

```bash
python deploy.py
```

Follow the prompts:
- Choose option 1 to generate a new test account OR
- Choose option 2 to use your existing Algorand wallet mnemonic

The script will:
- Deploy the contract to TestNet
- Generate `config.json`, `frontend/config.js`, and `backend/resources/algorand.properties`
- Display the App ID and contract address

### 5. Fund the Contract

Send at least **1 ALGO** to the contract address for box storage:

```bash
# Visit TestNet dispenser
https://bank.testnet.algorand.network/

# Paste your contract address (shown after deployment)
```

### 6. Compile Backend 

```bash
mvn clean compile
```

### 7. Run Frontend

```bash
cd frontend
python -m http.server 8000

```

Visit: `http://localhost:8000/index.html` 

## 📖 Usage

### Owner: Creating Guest Keys

1. Open the **Owner Dashboard** (`index.html`)
2. The system auto-connects with a dev account (or connect your Pera Wallet)
3. Click **"Create New Guest Key"**
4. Fill in:
   - Key Name (e.g., "Relative")
   - Recipient's Algorand Address
   - Start Time
   - End Time
5. Click **"Create & Sign"**
6. The key is created in the smart contract's box storage
7. Click the **QR icon** to generate a QR code for the guest

### Guest: Using Access Keys

1. Open the **Guest Portal** (`guest.html`)
2. Scan the QR code(or paste the JSON manually for testing)
3. The system verifies the key by reading from blockchain
4. If valid, door controls appear
5. Guest can lock/unlock the door (transactions logged on blockchain)

### Owner: Monitoring Activity

1. The **Activity Log** shows all door access events
2. Click **"Refresh"** to fetch latest blockchain transactions
3. Each event links to AlgoExplorer for verification
4. Revoke keys instantly by clicking the **revoke button**

## 🌐 Deployed Contracts

### TestNet Deployment

- **App ID**: `749658795`
- **Contract Address**: `GWWCEG6OYN2Q7R4G2LHKWC3KNQA44RTYCZA5ROPR2KHEEGJ3HT6NZOMRZE`
- **Creator**: `TT6OX3HEARM6E4SJKHEMDJ4O7446C5T4R4OMVYNW3LICEQAZTKOSO4HMLA`
- **Network**: Algorand TestNet

### Verification

View on block explorer:
- **Lora**: https://lora.algokit.io/testnet/application/749658795

Or verify via API:
```bash
# Check contract exists
curl "https://testnet-api.algonode.cloud/v2/applications/749658795" | jq

# View box storage (guest keys)
curl "https://testnet-api.algonode.cloud/v2/applications/749658795/boxes" | jq

# View recent transactions
curl "https://testnet-idx.algonode.cloud/v2/transactions?address=GWWCEG6OYN2Q7R4G2LHKWC3KNQA44RTYCZA5ROPR2KHEEGJ3HT6NZOMRZE&limit=10" | jq
```

## 🔧 Configuration

### Smart Contract Config (`smartContract/config.json`)
```json
{
  "app_id": 749658795,
  "app_address": "GWWCEG6OYN2Q7R4G2LHKWC3KNQA44RTYCZA5ROPR2KHEEGJ3HT6NZOMRZE",
  "network": "testnet"
}
```

### Frontend Config (`frontend/config.js`)
Auto-generated by `deploy.py`. Contains App ID and network settings.

### Backend Config (`backend/resources/algorand.properties`)
Auto-generated by `deploy.py`. Contains Algorand connection settings.

## 🔐 Security Considerations

- ✅ **Time-based access**: Enforced by blockchain timestamps (tamper-proof)
- ✅ **Owner-only control**: Smart contract checks sender is creator
- ✅ **Immutable logs**: All access events permanently recorded
- ✅ **No central server**: Fully decentralized architecture
- ⚠️ **TestNet only**: This deployment is for testing purposes only
- ⚠️ **Hardware integration**: Physical lock security depends on backend implementation is still incomplete

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 👥 Authors

- Ippili Tejeshwara Rao:[shiobana17](https://github.com/shiobana17)

## 🙏 Acknowledgments

- Built on [Algorand](https://www.algorand.com/) blockchain
- Uses [PyTeal](https://pyteal.readthedocs.io/) for smart contract development
- Frontend uses [AlgoSDK](https://github.com/algorand/js-algorand-sdk)
- Inspired by the need for convenient sharing of decentralized access control systems

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/shiobana17/Soteria/issues)
- **Discussions**: [GitHub Discussions](https://github.com/shiobana17/Soteria/discussions)
- **Email**: tejeshwara447@gmail.com

---

**⭐ If you find this project useful, please give it a star!**

Made with ❤️ using Algorand blockchain