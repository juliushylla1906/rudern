"""Live-Logger fuer Sportstech WRX500 via Bluetooth FTMS (Rower Data 0x2AD1).

Aufruf:  python rower.py [sekunden]
Speichert jede Messung als CSV in ./sessions/.
"""
import asyncio
import csv
import datetime as dt
import struct
import sys
import time
from pathlib import Path

from bleak import BleakClient, BleakScanner

NAME = "WRX500"
ROWER_DATA = "00002ad1-0000-1000-8000-00805f9b34fb"

# (flag bit, feldname, struct-format) in Spezifikationsreihenfolge (FTMS 4.8)
FIELDS = [
    (1, "avg_stroke_rate", "<B"),       # 0.5 spm
    (2, "distance_m", "u24"),
    (3, "pace_s_500m", "<H"),
    (4, "avg_pace_s_500m", "<H"),
    (5, "power_w", "<h"),
    (6, "avg_power_w", "<h"),
    (7, "resistance", "<h"),
    (8, "energy", "energy"),
    (9, "heart_rate", "<B"),
    (10, "met", "<B"),
    (11, "elapsed_s", "<H"),
    (12, "remaining_s", "<H"),
]


def parse_rower_data(data: bytes) -> dict:
    flags = int.from_bytes(data[0:2], "little")
    i = 2
    out = {}
    if not flags & 1:  # "More Data" = 0 -> Schlagfrequenz + Schlagzahl vorhanden
        out["stroke_rate_spm"] = data[i] / 2
        out["stroke_count"] = int.from_bytes(data[i + 1:i + 3], "little")
        i += 3
    for bit, name, fmt in FIELDS:
        if not flags & (1 << bit):
            continue
        if fmt == "u24":
            out[name] = int.from_bytes(data[i:i + 3], "little")
            i += 3
        elif fmt == "energy":
            out["kcal_total"], out["kcal_per_h"], out["kcal_per_min"] = struct.unpack_from("<HHB", data, i)
            i += 5
        else:
            (val,) = struct.unpack_from(fmt, data, i)
            out[name] = val / 2 if name == "avg_stroke_rate" else val
            i += struct.calcsize(fmt)
    return out


def fmt_pace(sec) -> str:
    if not sec:
        return "--:--"
    return f"{sec // 60}:{sec % 60:02d}"


COLUMNS = ["t", "elapsed_s", "distance_m", "pace_s_500m", "stroke_rate_spm", "stroke_count",
           "power_w", "kcal_total", "heart_rate", "resistance"]


async def main(duration: int):
    print(f"Suche {NAME} ...")
    dev = await BleakScanner.find_device_by_name(NAME, timeout=15)
    if not dev:
        sys.exit("Rudergeraet nicht gefunden (an? App auf dem Handy getrennt?)")

    Path("sessions").mkdir(exist_ok=True)
    path = Path("sessions") / f"row_{dt.datetime.now():%Y%m%d_%H%M%S}.csv"
    state: dict = {}
    t0 = time.monotonic()

    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        writer.writeheader()

        def on_data(_, data: bytearray):
            state.update(parse_rower_data(bytes(data)))
            if data[0] & 1:  # Folgepaket (Widerstand) -> auf Hauptpaket warten
                return
            row = {"t": round(time.monotonic() - t0, 2), **state}
            writer.writerow(row)
            f.flush()
            print(f"\r{fmt_pace(state.get('elapsed_s', 0)):>6}  "
                  f"{state.get('distance_m', 0):5d} m  "
                  f"/500m {fmt_pace(state.get('pace_s_500m', 0)):>5}  "
                  f"{state.get('stroke_rate_spm', 0):4.1f} spm  "
                  f"#{state.get('stroke_count', 0):<4d} "
                  f"{state.get('power_w', 0):4d} W  "
                  f"{state.get('kcal_total', 0):4d} kcal  "
                  f"HF {state.get('heart_rate', 0):3d}  "
                  f"Stufe {state.get('resistance', 0)}   ", end="", flush=True)

        async with BleakClient(dev) as client:
            print(f"Verbunden. Logge {duration}s nach {path}\n")
            await client.start_notify(ROWER_DATA, on_data)
            await asyncio.sleep(duration)
    print(f"\n\nGespeichert: {path}")


if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 3600))
