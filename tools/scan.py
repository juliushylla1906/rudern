import asyncio
from bleak import BleakScanner


async def main():
    found = await BleakScanner.discover(timeout=10.0, return_adv=True)
    for addr, (dev, adv) in sorted(found.items(), key=lambda x: -x[1][1].rssi):
        print(f"{addr}  rssi={adv.rssi:4d}  name={adv.local_name or dev.name!r}")
        if adv.service_uuids:
            print(f"    services: {adv.service_uuids}")
        if adv.manufacturer_data:
            print(f"    mfr: { {k: v.hex() for k, v in adv.manufacturer_data.items()} }")
        if adv.service_data:
            print(f"    svcdata: { {k: v.hex() for k, v in adv.service_data.items()} }")


asyncio.run(main())
