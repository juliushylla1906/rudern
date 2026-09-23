"""Sucht Pulssensoren und Garmin-Geräte per BLE und zeigt, was sie aussenden.

Aufruf:  python hr_scan.py [sekunden]
"""
import asyncio
import sys
import time

from bleak import BleakScanner

HR_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb"
GARMIN_COMPANY_ID = 0x0087
DURATION = int(sys.argv[1]) if len(sys.argv) > 1 else 240

seen: dict[str, str] = {}
t0 = time.monotonic()


def on_adv(dev, adv):
    name = adv.local_name or dev.name or ""
    is_hr = HR_SERVICE in adv.service_uuids
    is_garmin = GARMIN_COMPANY_ID in adv.manufacturer_data or any(
        k in name.lower() for k in ("fenix", "fēnix", "garmin", "forerunner", "epix", "hrm"))
    if not (is_hr or is_garmin):
        return
    desc = f"name={name!r} hr_service={is_hr} services={adv.service_uuids} " \
           f"mfr={ {hex(k): v.hex() for k, v in adv.manufacturer_data.items()} }"
    if seen.get(dev.address) != desc:
        seen[dev.address] = desc
        print(f"{time.monotonic() - t0:6.1f}s  {dev.address}  rssi={adv.rssi}  {desc}", flush=True)


async def main():
    print(f"Scanne {DURATION}s nach Pulssensoren / Garmin ...", flush=True)
    async with BleakScanner(on_adv):
        await asyncio.sleep(DURATION)
    print(f"Fertig. {len(seen)} passende Geräte.", flush=True)


asyncio.run(main())
