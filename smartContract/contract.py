# smartContract/contract.py - FIXED VERSION (No MaybeValue Issues)
from pyteal import *
from typing import Literal

from beaker import (
    Application,
    consts,
)

app = Application("Soteria")


@app.external
def create_key(
    key_id: abi.String,
    recipient: abi.Address,
    valid_from: abi.Uint64,
    valid_until: abi.Uint64,
):
    """
    Create a new guest access key stored in a box.
    Only the contract creator (owner) can create keys.
    """
    return Seq(
        # --- Security Checks ---
        Assert(Txn.sender() == Global.creator_address(), comment="Only owner can create keys"),
        
        # Validate times
        Assert(valid_from.get() < valid_until.get(), comment="Start must be before end"),
        Assert(valid_until.get() > Global.latest_timestamp(), comment="Cannot create expired key"),

        # --- Create and Store the Key Data ---
        # BoxCreate returns 1 if successful, 0 if already exists
        Assert(BoxCreate(key_id.get(), Int(64)), comment="Key already exists"),
        
        # Write recipient address at offset 0
        BoxReplace(key_id.get(), Int(0), recipient.get()),
        
        # Write valid_from timestamp at offset 32
        BoxReplace(key_id.get(), Int(32), Itob(valid_from.get())),
        
        # Write valid_until timestamp at offset 40
        BoxReplace(key_id.get(), Int(40), Itob(valid_until.get())),
        
        # Write status byte at offset 48 (1 = ACTIVE)
        BoxReplace(key_id.get(), Int(48), Itob(Int(1))),
    )


@app.external
def revoke_key(key_id: abi.String):
    """
    Revoke an existing guest access key.
    Only the contract creator (owner) can revoke keys.
    """
    # We'll use a scratch var to temporarily store the box data
    # This avoids the MaybeValue.hasValue() issue
    temp = ScratchVar(TealType.bytes)
    
    return Seq(
        # --- Security Checks ---
        Assert(Txn.sender() == Global.creator_address(), comment="Only owner can revoke"),
        
        # Read the box to verify it exists (will fail if it doesn't)
        temp.store(BoxExtract(key_id.get(), Int(0), Int(1))),
        
        # --- Update Status ---
        # Set status byte (at offset 48) to 0 (REVOKED)
        BoxReplace(key_id.get(), Int(48), Itob(Int(0))),
    )


@app.external(read_only=True)
def verify_access(key_id: abi.String, *, output: abi.String):
    """
    Verify if a guest key is valid for access.
    This is a read-only call that checks:
    1. Key exists
    2. Not revoked
    3. Current time is within valid period
    """
    # Use ScratchVar to store extracted values
    box_contents = ScratchVar(TealType.bytes)
    valid_from = ScratchVar(TealType.uint64)
    valid_until = ScratchVar(TealType.uint64)
    status = ScratchVar(TealType.uint64)
    
    return Seq(
        # --- Read the entire box (will fail if doesn't exist) ---
        box_contents.store(BoxExtract(key_id.get(), Int(0), Int(64))),
        
        # --- Extract data from box ---
        # Extract valid_from (8 bytes at offset 32)
        valid_from.store(Btoi(Extract(box_contents.load(), Int(32), Int(8)))),
        
        # Extract valid_until (8 bytes at offset 40)
        valid_until.store(Btoi(Extract(box_contents.load(), Int(40), Int(8)))),
        
        # Extract status (8 bytes at offset 48)
        status.store(Btoi(Extract(box_contents.load(), Int(48), Int(8)))),
        
        # --- Check 2: Is it revoked? ---
        If(
            status.load() == Int(0),
            output.set("DENIED_REVOKED"),
            # --- Check 3: Time-Lock Validation ---
            If(
                Global.latest_timestamp() < valid_from.load(),
                output.set("DENIED_NOT_YET_VALID"),
                If(
                    Global.latest_timestamp() > valid_until.load(),
                    output.set("DENIED_EXPIRED"),
                    # --- All checks passed! ---
                    output.set("GRANTED")
                )
            )
        ),
    )


# Build and export the contract
if __name__ == "__main__":
    import json
    import os

    print("=" * 60)
    print("COMPILING SOTERIA SMART CONTRACT")
    print("=" * 60)
    print()

    artifacts_dir = "smartContract/artifacts"
    if not os.path.exists(artifacts_dir):
        os.makedirs(artifacts_dir)
        print(f"✓ Created directory: {artifacts_dir}/")

    try:
        # Build and export
        app_spec = app.build()
        app_spec.export(artifacts_dir)

        print(f"✅ Contract compiled successfully!")
        print(f"   Output directory: {artifacts_dir}/")
        print()
        print("Files created:")
        print(f"   ✓ approval.teal")
        print(f"   ✓ clear.teal")
        print(f"   ✓ abi.json")
        print()
        print("=" * 60)
        print("NEXT STEP: Run deployment script")
        print("=" * 60)
        print("   python smartContract/deploy.py")
        print("=" * 60)

    except Exception as e:
        print("=" * 60)
        print("❌ COMPILATION FAILED")
        print("=" * 60)
        print(f"Error: {e}")
        print()
        import traceback
        traceback.print_exc()