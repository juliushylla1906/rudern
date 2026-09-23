"""Connect to the rower, dump the GATT table and log raw notifications."""
import asyncio
import sys
import time

from bleak import BleakClient, BleakScanner

NAME = "WRX500"
LISTEN_SECONDS = int(sys.argv[1]) if len(sys.argv) > 1 else 20


async def main():
    dev = await BleakScanner.find_device_by_name(NAME, timeout=15)
    if not dev:
        print("device not found")
        return
    async with BleakClient(dev) as client:
        print(f"connected to {dev.address}")
        notify_chars = []
        for svc in client.services:
            print(f"\n[service] {svc.uuid}  {svc.description}")
            for ch in svc.characteristics:
                line = f"  [char] {ch.uuid}  {ch.description}  props={ch.properties}"
                if "read" in ch.properties:
                    try:
                        val = await client.read_gatt_char(ch)
                        line += f"  value={val.hex()}  {val!r}"
                    except Exception as e:
                        line += f"  read-error={e}"
                print(line)
                if "notify" in ch.properties or "indicate" in ch.properties:
                    notify_chars.append(ch)

        t0 = time.monotonic()

        def make_handler(uuid):
            def handler(_, data: bytearray):
                print(f"{time.monotonic() - t0:7.2f}s  {uuid[4:8]}  {data.hex()}")
            return handler

        for ch in notify_chars:
            try:
                await client.start_notify(ch, make_handler(ch.uuid))
            except Exception as e:
                print(f"notify failed {ch.uuid}: {e}")

        print(f"\nlistening {LISTEN_SECONDS}s ...")
        await asyncio.sleep(LISTEN_SECONDS)


asyncio.run(main())
