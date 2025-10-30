# smartContract/contract.py
from pyteal import *
from typing import Literal

from beaker import (
    Application,
    consts,
)

class SoteriaState:

    pass

app = Application("Soteria", state=SoteriaState())


@app.external
def create_key(
    key_id: abi.String,
    recipient: abi.Address,
    valid_from: abi.Uint64,
    valid_until: abi.Uint64,
):
    return Seq(
        # --- Security Checks ---
        # Assert the sender is the app creator (the owner)
        Assert(Txn.sender() == Global.creator_address()),
        # Assert the key doesn't already exist
        Assert(app.boxes[key_id.get()].exists() == Int(0)),
        # Assert the times are valid
        Assert(valid_from.get() < valid_until.get()),
        Assert(valid_until.get() > Global.latest_timestamp()), # Can't create expired keys

        # --- Store the Key Data ---
        # 1. Create a new "Box" (storage space) named after the key_id
        # We need 32 (addr) + 8 (time) + 8 (time) + 1 (status) = 49 bytes. Let's make it 64.
        app.boxes[key_id.get()].create(Int(64)), 

        # 2. Pack and store the data.
        # We'll store:
        # - recipient (32 bytes)
        # - valid_from (8 bytes)
        # - valid_until (8 bytes)
        # - status (1 byte: 1=ACTIVE, 0=REVOKED)
        
        # Write recipient address at index 0
        app.boxes[key_id.get()].replace(Int(0), recipient.get()),
        
        # Write valid_from timestamp at index 32
        app.boxes[key_id.get()].replace(Int(32), Itob(valid_from.get())),
        
        # Write valid_until timestamp at index 40
        app.boxes[key_id.get()].replace(Int(40), Itob(valid_until.get())),
        
        # Write status (1 for ACTIVE) at index 48
        app.boxes[key_id.get()].replace(Int(48), Int(1)),
    )


@app.external
def revoke_key(key_id: abi.String):

    return Seq(
        # --- Security Checks ---
        # Assert the sender is the app creator (the owner)
        Assert(Txn.sender() == Global.creator_address()),
        # Assert the key *does* exist
        Assert(app.boxes[key_id.get()].exists() == Int(1)),
        
        # --- Update the Status ---
        # Set the status byte (at index 48) to 0 (REVOKED)
        app.boxes[key_id.get()].replace(Int(48), Int(0)),
    )


@app.external(read_only=True)
def verify_access(key_id: abi.String, *, output: abi.String):
    
    # Read the data from the box
    box_data = app.boxes[key_id.get()].get()
    
    # Use ScratchVar to store values temporarily
    valid_from = ScratchVar(TealType.uint64)
    valid_until = ScratchVar(TealType.uint64)
    status = ScratchVar(TealType.uint64)

    return Seq(
        # --- Check 1: Does the key exist? ---
        Assert(app.boxes[key_id.get()].exists() == Int(1), comment="Key must exist"),

        # --- Unpack the data ---
        # Get valid_from (8 bytes at index 32)
        valid_from.store(Btoi(Extract(box_data, Int(32), Int(8)))),
        # Get valid_until (8 bytes at index 40)
        valid_until.store(Btoi(Extract(box_data, Int(40), Int(8)))),
        # Get status (1 byte at index 48)
        status.store(Btoi(Extract(box_data, Int(48), Int(1)))),

        # --- Check 2: Is it revoked? ---
        If(status.load() == Int(0),
            Return(output.set("DENIED_REVOKED"))
        ),

        # --- Check 3: Time-Lock ---
        # This is MUCH more secure. It uses the blockchain's official time.
        If(Global.latest_timestamp() < valid_from.load(),
            Return(output.set("DENIED_NOT_YET_VALID"))
        ),
        If(Global.latest_timestamp() > valid_until.load(),
            Return(output.set("DENIED_EXPIRED"))
        ),

        # --- All checks passed! ---
        output.set("GRANTED")
    )


# This is the boilerplate to build the contract
if __name__ == "__main__":
    import json
    import os

    # Create an 'artifacts' folder if it doesn't exist
    artifacts_dir = "smartContract/artifacts"
    if not os.path.exists(artifacts_dir):
        os.makedirs(artifacts_dir)

    # Build the application and export it to the artifacts folder
    app.build().export(artifacts_dir)
    
    # Print a message
    print(f"✅ Contract compiled! Check the '{artifacts_dir}' folder.")
    print("   You'll find approval.teal, clear.teal, and abi.json")