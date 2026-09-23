# Rudern

Web-App zum Auslesen, Anzeigen und Speichern der Trainingsdaten des **Sportstech WRX500**, ohne Sportstech-Abo.

## Wie es funktioniert

- Das Rudergerät (Bluetooth-Modul FITSHOW FS-BT-D2) sendet über den offenen Standard **FTMS** (Service `0x1826`, Characteristic *Rower Data* `0x2AD1`) etwa alle 0,5 s Zeit, Distanz, Split, Schlagfrequenz, Schläge, Watt, kcal, Herzfrequenz und Widerstand.
- Die App verbindet sich per **Web Bluetooth**: am Laptop in Chrome/Edge, auf dem iPhone in der App **Bluefy**.
- Einheiten werden **lokal** (IndexedDB) gespeichert und bei Anmeldung mit **Supabase** synchronisiert (Projekt `rudern`, eu-central-1, Free-Plan). Row Level Security sorgt dafür, dass jede Person nur ihre eigenen Einheiten sieht.
- Datensparsam: Hochgeladen werden nur neue Einheiten (~20–80 KB pro 45 min). Heruntergeladen werden nur Zusammenfassungen, die Messpunkte erst beim Öffnen einer Einheit.

## Struktur

| Pfad | Inhalt |
|---|---|
| `app/` | Die Web-App (statisch, ohne Build-Schritt) |
| `app/config.js` | Supabase-URL und Publishable Key (öffentlich, darf im Client stehen) |
| `serve.js` | Minimaler lokaler Server (`node serve.js`, dann http://localhost:8080) |
| `tools/` | Python-Diagnose-Skripte (`bleak`): BLE-Scan, GATT-Dump, Terminal-Logger |

## Datenbank

Tabelle `public.sessions`: eine Zeile pro Einheit mit Zusammenfassung, `bests` (beste 500 m / 1 km / 2 km / 5 km / 30 min) und `samples` (jsonb, sekündlich
`[zeit_s, distanz_m, split_s, spm, watt, hf, schläge, kcal]`).
