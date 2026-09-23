"use strict";

// ================= FTMS (Bluetooth Fitness Machine Service) =================
const FTMS_SERVICE = 0x1826;
const ROWER_DATA = 0x2ad1;

// FTMS Rower Data (0x2AD1), Felder in Spezifikationsreihenfolge
function parseRowerData(dv) {
  const f = dv.getUint16(0, true);
  let i = 2;
  const o = {};
  if (!(f & 0x0001)) { o.spm = dv.getUint8(i) / 2; o.strokes = dv.getUint16(i + 1, true); i += 3; }
  if (f & 0x0002) { i += 1; }
  if (f & 0x0004) { o.dist = dv.getUint16(i, true) | (dv.getUint8(i + 2) << 16); i += 3; }
  if (f & 0x0008) { o.pace = dv.getUint16(i, true); i += 2; }
  if (f & 0x0010) { i += 2; }
  if (f & 0x0020) { o.power = dv.getInt16(i, true); i += 2; }
  if (f & 0x0040) { i += 2; }
  if (f & 0x0080) { o.resistance = dv.getInt16(i, true); i += 2; }
  if (f & 0x0100) { o.kcal = dv.getUint16(i, true); i += 5; }
  if (f & 0x0200) { o.hr = dv.getUint8(i); i += 1; }
  if (f & 0x0400) { i += 1; }
  if (f & 0x0800) { o.elapsed = dv.getUint16(i, true); i += 2; }
  return { more: !!(f & 0x0001), data: o };
}

// Heart Rate Measurement (0x2A37): Flags, dann HF als uint8 oder uint16
function parseHeartRate(dv) {
  return dv.getUint8(0) & 0x01 ? dv.getUint16(1, true) : dv.getUint8(1);
}

// ================= Helpers =================
const $ = (id) => document.getElementById(id);
const DAY = 86400000;
function fmtTime(s) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
function fmtPace(s) { return s > 0 && s < 3600 ? fmtTime(s) : "–:––"; }
const nf = new Intl.NumberFormat("de-DE");
const km = (m) => (m / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const shortDate = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });
const listDate = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const monthFmt = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ================= Einstellungen & Theme =================
const settings = { maxHr: null };
try { Object.assign(settings, JSON.parse(localStorage.getItem("rudern-settings") || "{}")); } catch {}
function saveSettings() {
  try { localStorage.setItem("rudern-settings", JSON.stringify(settings)); } catch {}
  // geräteübergreifend im Konto merken
  if (cloud.user) cloud.client.auth.updateUser({ data: { max_hr: settings.maxHr } });
}

function applyTheme(t) {
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem("rudern-theme", t); } catch {}
  document.querySelectorAll("#themeSeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.themeOpt === t));
  const dark = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]').content = dark ? "#1a1a19" : "#0f6fb8";
  showView(currentView); // Diagramme mit neuen Farben neu zeichnen
}
function currentTheme() { try { return localStorage.getItem("rudern-theme") || "auto"; } catch { return "auto"; } }

// ================= Pulszonen (% der maximalen Herzfrequenz, wie bei Garmin) =================
const ZONES = [
  { n: 1, name: "Aufwärmen", lo: 0.5 },
  { n: 2, name: "Leicht", lo: 0.6 },
  { n: 3, name: "Aerob", lo: 0.7 },
  { n: 4, name: "Schwelle", lo: 0.8 },
  { n: 5, name: "Maximum", lo: 0.9 },
];
const zoneColor = (n) => (n ? `var(--z${n})` : "var(--surface-2)");
function zoneOf(bpm) {
  const m = settings.maxHr;
  if (!m || !bpm) return 0;
  let z = 0;
  for (const Z of ZONES) if (bpm >= Z.lo * m) z = Z.n;
  return z;
}
function zoneRange(n) {
  const m = settings.maxHr, Z = ZONES[n - 1];
  const lo = Math.round(Z.lo * m), hi = n < 5 ? Math.round(ZONES[n].lo * m) - 1 : null;
  return hi ? `${lo}–${hi}` : `≥ ${lo}`;
}
// Sekunden je Pulswert – kompakt speicherbar, Zonen lassen sich damit für jede Max-HF neu berechnen
function hrHistogram(samples) {
  const h = {};
  for (const x of samples) if (x[5] > 0) h[x[5]] = (h[x[5]] || 0) + 1;
  return h;
}
function zoneSeconds(hist) {
  const t = [0, 0, 0, 0, 0, 0]; // Index 0 = unter Zone 1
  for (const [bpm, s] of Object.entries(hist || {})) t[zoneOf(+bpm)] += s;
  return t;
}

// Karte mit Balken + Tabelle (Tabelle trägt Zahlen und Namen, Farbe ist nie alleiniger Träger)
function renderZones(el, hist, title) {
  const secs = zoneSeconds(hist);
  const total = secs.reduce((a, b) => a + b, 0);
  el.classList.toggle("hidden", total === 0);
  if (!total) return;
  if (!settings.maxHr) {
    el.innerHTML = `<h3>${title}</h3><p class="muted" style="margin:0;font-size:14px">Trag unter <b>Konto → Einstellungen</b> deine maximale Herzfrequenz ein, dann erscheinen hier deine Pulszonen.</p>`;
    return;
  }
  const rows = [5, 4, 3, 2, 1, 0].filter((n) => n > 0 || secs[0] > 0);
  el.innerHTML = `<h3>${title}</h3>
    <div class="zonebar" role="img" aria-label="Zeit in Pulszonen">${[0, 1, 2, 3, 4, 5].filter((n) => secs[n]).map((n) =>
      `<div style="--zc:${zoneColor(n)};flex:${secs[n]}"></div>`).join("")}</div>
    <table class="zlegend"><tbody>${rows.map((n) => {
      const pct = Math.round((secs[n] / total) * 100);
      const label = n ? `Z${n} ${ZONES[n - 1].name}` : "unter Z1";
      const range = n ? zoneRange(n) : `< ${Math.round(0.5 * settings.maxHr)}`;
      return `<tr style="--zc:${zoneColor(n)}"><td><i></i>${label}</td><td class="muted num">${range}</td>
        <td class="pctbar"><span style="width:${pct}%"></span></td><td class="r num">${fmtTime(secs[n])}</td><td class="r num muted">${pct} %</td></tr>`;
    }).join("")}</tbody></table>`;
}

// ================= Lokaler Speicher (IndexedDB) =================
// Einheit: { id, owner, start, duration, distance, strokes, kcal, avgPace, avgSpm, avgPower, maxPower, avgHr,
//            bests, samples | null (nur in Cloud), synced }
const db = {
  _p: null,
  open() {
    return this._p ??= new Promise((res, rej) => {
      const r = indexedDB.open("rudern", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("sessions", { keyPath: "id" });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction("sessions", mode);
      const req = fn(t.objectStore("sessions"));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
    });
  },
  put(s) { return this.tx("readwrite", (st) => st.put(s)); },
  get(id) { return this.tx("readonly", (st) => st.get(id)); },
  del(id) { return this.tx("readwrite", (st) => st.delete(id)); },
  all() { return this.tx("readonly", (st) => st.getAll()); },
};

// ================= Cloud (Supabase) =================
// supabase-js wird nachgeladen, damit die App auch offline startet und aufzeichnet.
const cloud = { client: null, user: null };
const SUMMARY_COLS = "id,user_id,started_at,duration_s,distance_m,strokes,kcal,avg_pace_s,avg_spm,avg_power_w,max_power_w,avg_hr,bests";

async function initCloud() {
  try {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    const { SUPABASE_URL, SUPABASE_KEY } = window.RUDERN_CONFIG;
    cloud.client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    const { data } = await cloud.client.auth.getSession();
    cloud.user = data.session?.user ?? null;
    cloud.client.auth.onAuthStateChange((_ev, s) => {
      const prev = cloud.user?.id;
      cloud.user = s?.user ?? null;
      if (cloud.user?.id !== prev) { renderAccount(); refreshViews(); if (cloud.user) sync(); }
    });
  } catch (e) {
    console.warn("Cloud nicht erreichbar", e);
    $("cloudOffline").textContent = "Cloud gerade nicht erreichbar – Einheiten werden lokal gespeichert und später hochgeladen.";
  }
  renderAccount();
  if (cloud.user) sync();
}

function toRow(s) {
  return {
    user_id: s.owner, id: s.id, started_at: s.start,
    duration_s: s.duration, distance_m: s.distance, strokes: s.strokes, kcal: s.kcal,
    avg_pace_s: s.avgPace, avg_spm: s.avgSpm, avg_power_w: s.avgPower, max_power_w: s.maxPower, avg_hr: s.avgHr,
    bests: s.bests ?? {}, samples: s.samples, device: s.device ?? null, updated_at: new Date().toISOString(),
  };
}
function fromRow(r) {
  return {
    id: Number(r.id), owner: r.user_id, start: r.started_at,
    duration: r.duration_s, distance: r.distance_m, strokes: r.strokes, kcal: r.kcal,
    avgPace: r.avg_pace_s ?? 0, avgSpm: r.avg_spm ?? 0, avgPower: r.avg_power_w ?? 0, maxPower: r.max_power_w ?? 0, avgHr: r.avg_hr ?? 0,
    bests: r.bests ?? {}, samples: r.samples ?? null, synced: true,
  };
}

function setSyncMsg(t) { $("syncMsg").textContent = t; }

let syncing = null;
function sync() { return (syncing ??= doSync().finally(() => { syncing = null; })); }

// Datensparsam: hochgeladen werden nur neue Einheiten; heruntergeladen nur IDs und
// Zusammenfassungen fehlender Einheiten. Messpunkte erst beim Öffnen einer Einheit.
async function doSync() {
  if (!cloud.client || !cloud.user || !navigator.onLine) return;
  const uid = cloud.user.id;
  setSyncMsg("Synchronisiere …");
  try {
    let local = await db.all();
    for (const s of local) {
      if (!s.owner) { s.owner = uid; s.synced = false; await db.put(s); } // ohne Anmeldung aufgezeichnet
      // Einheiten mit Puls aus älteren App-Versionen: Pulsverteilung nachrüsten
      if (s.samples && !s.bests?.hrHist && s.samples.some((x) => x[5] > 0)) { summarize(s); s.synced = false; await db.put(s); }
    }
    const pending = local.filter((s) => s.owner === uid && !s.synced && s.samples && s.id !== session?.id);
    if (pending.length) {
      const { error } = await cloud.client.from("sessions").upsert(pending.map(toRow), { onConflict: "user_id,id" });
      if (error) throw error;
      for (const s of pending) { s.synced = true; await db.put(s); }
    }

    const { data: ids, error: e1 } = await cloud.client.from("sessions").select("id");
    if (e1) throw e1;
    const remote = new Set(ids.map((r) => Number(r.id)));
    const localIds = new Set(local.map((s) => s.id));
    const missing = [...remote].filter((id) => !localIds.has(id));
    if (missing.length) {
      const { data, error } = await cloud.client.from("sessions").select(SUMMARY_COLS).in("id", missing);
      if (error) throw error;
      for (const r of data) await db.put(fromRow(r));
    }
    // auf einem anderen Gerät gelöscht
    for (const s of local) if (s.owner === uid && s.synced && !remote.has(s.id)) await db.del(s.id);

    const n = remote.size;
    setSyncMsg(`${n} ${n === 1 ? "Einheit" : "Einheiten"} in der Cloud · synchronisiert ${timeFmt.format(new Date())}`);
  } catch (e) {
    console.warn(e);
    setSyncMsg("Synchronisierung fehlgeschlagen – wird später erneut versucht.");
  }
  refreshViews();
}
window.addEventListener("online", () => sync());

// Einheiten, die auf diesem Gerät angezeigt werden
async function visibleSessions() {
  const uid = cloud.user?.id;
  const all = await db.all();
  return all.filter((s) => !uid || !s.owner || s.owner === uid).sort((a, b) => b.id - a.id);
}

// ================= Auswertung einer Einheit =================
// sample: [zeit_s, distanz_m, split_s, spm, watt, hf, schläge, kcal]
function bestEfforts(sm) {
  const pts = [[0, 0], ...sm];
  const out = {};
  for (const D of [500, 1000, 2000, 5000]) {
    let best = null, i = 0;
    for (let j = 1; j < pts.length; j++) {
      while (i + 1 < j && pts[j][1] - pts[i + 1][1] >= D) i++;
      if (pts[j][1] - pts[i][1] >= D) {
        const t = pts[j][0] - pts[i][0];
        if (best === null || t < best) best = t;
      }
    }
    out[D] = best;
  }
  let best30 = null, i = 0;
  if (pts[pts.length - 1][0] >= 1800) {
    for (let j = 1; j < pts.length; j++) {
      while (pts[j][0] - pts[i][0] > 1800) i++;
      if (pts[j][0] - pts[i][0] >= 1795) best30 = Math.max(best30 ?? 0, pts[j][1] - pts[i][1]);
    }
  }
  out["30min"] = best30;
  return out;
}

function summarize(s) {
  const sm = s.samples;
  const last = sm[sm.length - 1] || [0, 0, 0, 0, 0, 0, 0, 0];
  const moving = sm.filter((x) => x[3] > 0);
  const avg = (k) => (moving.length ? moving.reduce((a, x) => a + x[k], 0) / moving.length : 0);
  const hrs = sm.filter((x) => x[5] > 0);
  s.duration = last[0];
  s.distance = last[1];
  s.strokes = last[6];
  s.kcal = last[7];
  s.avgPace = s.distance > 0 ? (s.duration / s.distance) * 500 : 0;
  s.avgSpm = Math.round(avg(3) * 10) / 10;
  s.avgPower = Math.round(avg(4));
  s.maxPower = Math.max(0, ...sm.map((x) => x[4]));
  s.avgHr = hrs.length ? Math.round(hrs.reduce((a, x) => a + x[5], 0) / hrs.length) : 0;
  s.bests = bestEfforts(sm);
  if (hrs.length) s.bests.hrHist = hrHistogram(sm);
  return s;
}

// ================= Aufzeichnung =================
let live = {};
let session = null;
let lastSaved = 0;
// Nach manuellem Speichern zählt das Gerät weiter: neue Einheit relativ zu diesem Stand
let base = null;
const ZERO = { elapsed: 0, dist: 0, strokes: 0, kcal: 0 };
// Pausen bis zu dieser Länge (z. B. Trinkpause) gehören noch zur selben Einheit,
// auch wenn der Ruder-Computer zwischendurch auf null springt oder die Verbindung abreißt
const MAX_PAUSE_MS = 10 * 60 * 1000;

// Werte der laufenden Einheit: Gerätestand minus Startstand plus Übertrag aus früheren Abschnitten
function totals() {
  const b = base ?? ZERO, c = session?.carry ?? ZERO;
  return {
    elapsed: Math.max(0, (live.elapsed ?? 0) - b.elapsed) + c.elapsed,
    dist: Math.max(0, (live.dist ?? 0) - b.dist) + c.dist,
    strokes: Math.max(0, (live.strokes ?? 0) - b.strokes) + c.strokes,
    kcal: Math.max(0, (live.kcal ?? 0) - b.kcal) + c.kcal,
  };
}

async function saveSession(final) {
  const s = session;
  if (!s) return;
  if (final) session = null;
  if (!s.samples.length) return;
  summarize(s);
  if (s.distance <= 0) return;
  s.synced = false;
  const { lastElapsed, carry, movedAt, ...record } = s;
  await db.put(record);
  lastSaved = Date.now();
  if (final) { sync(); refreshViews(); }
}

function finishManually() {
  base = { elapsed: live.elapsed ?? 0, dist: live.dist ?? 0, strokes: live.strokes ?? 0, kcal: live.kcal ?? 0 };
  return saveSession(true);
}

function currentHr() {
  // externer Pulsmesser hat Vorrang; Werte älter als 5 s gelten als Aussetzer
  if (hr.value && Date.now() - hr.at < 5000) return hr.value;
  return live.hr ?? 0;
}

function onRowerData(d) {
  Object.assign(live, d);
  const el = live.elapsed ?? 0;

  // zu lange Pause -> alte Einheit abschließen, ab hier beginnt eine neue
  if (session && Date.now() - session.movedAt > MAX_PAUSE_MS) finishManually();
  // Gerät hat seine Zähler zurückgesetzt (passiert nach kurzer Pause) -> Einheit läuft weiter,
  // bisherige Werte werden als Übertrag auf den neuen Abschnitt aufgeschlagen
  if (base && el < base.elapsed) base = null;
  if (session && el < session.lastElapsed) {
    const last = session.samples[session.samples.length - 1];
    session.carry = last ? { elapsed: last[0], dist: last[1], strokes: last[6], kcal: last[7] } : ZERO;
    session.lastElapsed = el;
    base = null;
  }
  const b = base ?? ZERO;

  if (!session && el > b.elapsed && ((live.dist ?? 0) > b.dist || (live.strokes ?? 0) > b.strokes)) {
    session = {
      id: Date.now(), owner: cloud.user?.id ?? null, start: new Date().toISOString(),
      device: device?.name ?? (demoTimer ? "Demo" : null), samples: [], lastElapsed: b.elapsed,
      carry: ZERO, movedAt: Date.now(),
    };
  }
  if (session && el !== session.lastElapsed) {
    session.lastElapsed = el;
    const t = totals(), prev = session.samples[session.samples.length - 1];
    if (!prev || t.dist > prev[1] || t.strokes > prev[6]) session.movedAt = Date.now();
    session.samples.push([t.elapsed, t.dist, live.pace ?? 0, live.spm ?? 0, live.power ?? 0,
      currentHr(), t.strokes, t.kcal]);
    if (Date.now() - lastSaved > 15000) saveSession(false);
  }
  renderLive();
}

// ================= Bluetooth =================
let device = null, demoTimer = null, wakeLock = null, userDisconnect = false;

async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (device || demoTimer)) keepAwake();
  if (document.visibilityState === "hidden" && session) saveSession(false);
});

function setStatus(state, text) {
  $("status").dataset.state = state;
  $("statusText").textContent = text;
  const active = state !== "idle";
  $("btnConnect").disabled = active || !navigator.bluetooth;
  $("btnDemo").disabled = active;
  $("btnDisconnect").disabled = !active;
  $("btnFinish").disabled = !active && !session;
}

async function connect() {
  try {
    userDisconnect = false;
    device = await navigator.bluetooth.requestDevice({ filters: [{ services: [FTMS_SERVICE] }] });
    device.addEventListener("gattserverdisconnected", onDisconnected);
    await startNotifications();
    keepAwake();
  } catch (e) {
    if (e.name !== "NotFoundError") alert("Verbindung fehlgeschlagen: " + e.message);
    device = null;
    setStatus("idle", "Nicht verbunden");
  }
}

async function startNotifications() {
  setStatus("connected", "Verbinde …");
  const server = await device.gatt.connect();
  const svc = await server.getPrimaryService(FTMS_SERVICE);
  const ch = await svc.getCharacteristic(ROWER_DATA);
  ch.addEventListener("characteristicvaluechanged", (ev) => handlePacket(ev.target.value));
  await ch.startNotifications();
  setStatus("connected", device.name || "Verbunden");
  $("hint").textContent = "Verbunden. Die Aufzeichnung startet automatisch beim ersten Schlag.";
}

let pending = {};
function handlePacket(dv) {
  try {
    const { more, data } = parseRowerData(dv);
    Object.assign(pending, data);
    if (more) return; // Folgepaket, auf Hauptpaket warten
    const d = pending;
    pending = {};
    onRowerData(d);
  } catch (e) { console.warn("Paket verworfen", e); }
}

async function onDisconnected() {
  if (userDisconnect) return;
  setStatus("connected", "Verbindung verloren – verbinde neu …");
  for (let i = 0; i < 5 && device && !userDisconnect; i++) {
    try { await startNotifications(); return; } catch { await new Promise((r) => setTimeout(r, 2000)); }
  }
  // Einheit offen lassen: Nach erneutem Verbinden innerhalb der Pausengrenze geht sie weiter
  await saveSession(false);
  device = null;
  setStatus("idle", session ? "Verbindung verloren – neu verbinden, um fortzusetzen" : "Nicht verbunden");
}

async function disconnect() {
  userDisconnect = true;
  await saveSession(true);
  if (device?.gatt.connected) device.gatt.disconnect();
  device = null;
  if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
  try { await wakeLock?.release(); } catch {}
  live = {};
  base = null;
  renderLive();
  setStatus("idle", "Nicht verbunden");
}

// ================= Pulsmesser (Brustgurt oder Uhr mit HF-Übertragung, z. B. Garmin) =================
const hr = { device: null, value: 0, at: 0, userDisconnect: false };

async function connectHr() {
  if (hr.device) { // zweiter Tipp trennt
    hr.userDisconnect = true;
    if (hr.device.gatt.connected) hr.device.gatt.disconnect();
    hr.device = null; hr.value = 0;
    renderHr();
    return;
  }
  try {
    hr.userDisconnect = false;
    hr.device = await navigator.bluetooth.requestDevice({ filters: [{ services: ["heart_rate"] }] });
    hr.device.addEventListener("gattserverdisconnected", onHrDisconnected);
    await startHr();
  } catch (e) {
    if (e.name !== "NotFoundError") alert("Pulsmesser: " + e.message);
    hr.device = null;
  }
  renderHr();
}

async function startHr() {
  $("hrSource").textContent = "· verbinde …";
  const server = await hr.device.gatt.connect();
  const ch = await (await server.getPrimaryService("heart_rate")).getCharacteristic("heart_rate_measurement");
  ch.addEventListener("characteristicvaluechanged", (ev) => {
    hr.value = parseHeartRate(ev.target.value);
    hr.at = Date.now();
    renderHr();
  });
  await ch.startNotifications();
  renderHr();
}

async function onHrDisconnected() {
  if (hr.userDisconnect || !hr.device) return;
  hr.value = 0;
  $("hrSource").textContent = "· Verbindung verloren …";
  for (let i = 0; i < 5 && hr.device && !hr.userDisconnect; i++) {
    try { await startHr(); return; } catch { await new Promise((r) => setTimeout(r, 2000)); }
  }
  hr.device = null;
  renderHr();
}

function renderHr() {
  const v = currentHr();
  $("vHr").textContent = v > 0 ? v : "–";
  const z = zoneOf(v);
  const tileEl = $("vHr").closest(".tile");
  if (z) tileEl.style.setProperty("--zc", zoneColor(z)); else tileEl.style.removeProperty("--zc");
  $("vZone").innerHTML = z ? `<i style="--zc:${zoneColor(z)}"></i>Z${z} ${ZONES[z - 1].name}` : "";
  $("btnHr").textContent = hr.device ? "Trennen" : "Uhr / Gurt koppeln";
  $("btnHr").disabled = !navigator.bluetooth;
  $("hrSource").textContent = hr.device ? `· ${hr.device.name || "verbunden"}` : "";
}

// Demo: erzeugt echte FTMS-Pakete und schickt sie durch denselben Parser
function startDemo() {
  let t = 0, dist = 0, strokes = 0, tick = 0, kcal = 0;
  setStatus("connected", "Demo");
  $("hint").textContent = "Demo-Modus: simulierte Daten. Einheiten werden trotzdem gespeichert.";
  keepAwake();
  demoTimer = setInterval(() => {
    tick++;
    if (tick % 2 === 0) t++;
    const pace = Math.round(135 + 12 * Math.sin(t / 40) + (Math.random() * 6 - 3));
    const spm = Math.round(24 + 2 * Math.sin(t / 25) + Math.random());
    if (tick % 2 === 0) { dist += 500 / pace; if (t % Math.round(60 / spm) === 0) strokes++; kcal = Math.round(t * 0.2); }
    const power = Math.round(2.8 / Math.pow(pace / 500, 3));
    const b = new DataView(new ArrayBuffer(20));
    b.setUint16(0, 0x0b2c, true);
    b.setUint8(2, spm * 2); b.setUint16(3, strokes, true);
    const d = Math.floor(dist); b.setUint16(5, d & 0xffff, true); b.setUint8(7, d >> 16);
    b.setUint16(8, pace, true); b.setInt16(10, power, true);
    b.setUint16(12, kcal, true); b.setUint8(17, 118 + Math.round(t / 10) % 40);
    b.setUint16(18, t, true);
    handlePacket(b);
    const r = new DataView(new ArrayBuffer(4)); r.setUint16(0, 0x0081, true); r.setInt16(2, 4, true);
    handlePacket(r);
  }, 500);
}

// ================= Live =================
function renderLive() {
  const { elapsed: el, dist, strokes, kcal } = totals();
  $("vPace").textContent = live.spm > 0 ? fmtPace(live.pace) : "–:––";
  $("vAvgPace").textContent = dist > 0 ? fmtPace((el / dist) * 500) : "–:––";
  $("vTime").textContent = fmtTime(el);
  $("vDist").textContent = nf.format(dist);
  $("vSpm").textContent = Math.round(live.spm ?? 0);
  $("vPower").textContent = live.power ?? 0;
  $("vStrokes").textContent = strokes;
  $("vKcal").textContent = kcal;
  $("vMps").textContent = strokes > 0 ? (dist / strokes).toLocaleString("de-DE", { maximumFractionDigits: 1 }) : "–";
  renderHr();
  if (session) setStatus("recording", "Aufzeichnung läuft");
  else if (device || demoTimer) setStatus("connected", device?.name || "Demo");

  const wrap = $("liveChartWrap");
  const pts = session?.samples.filter((s) => s[2] > 0 && s[3] > 0) ?? [];
  wrap.classList.toggle("hidden", pts.length < 3);
  if (pts.length >= 3 && currentView === "live") {
    lineChart($("liveChart"), pts.map((s) => s[0]), pts.map((s) => s[2]), { invert: true, fmt: fmtPace, height: 160, unit: "/500 m" });
  }
}

// ================= Charts (SVG, ohne Bibliotheken) =================
const NS = "http://www.w3.org/2000/svg";
function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  parent?.appendChild(n);
  return n;
}
function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(6));
  return out;
}
function tooltip(container) {
  let t = container.querySelector(".tooltip");
  if (!t) { t = document.createElement("div"); t.className = "tooltip hidden"; container.appendChild(t); }
  return t;
}
function placeTip(tip, container, x, y) {
  tip.classList.remove("hidden");
  const w = tip.offsetWidth, cw = container.clientWidth;
  tip.style.left = Math.min(Math.max(0, x - w / 2), cw - w) + "px";
  tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + "px";
}

// opts: invert, zero, fmt (y), unit, height, label, xfmt (x-Beschriftung; Standard mm:ss), tipX, dots, onClick(i)
function lineChart(container, xs, ys, opts = {}) {
  const W = Math.max(280, container.clientWidth), H = opts.height ?? 180;
  const m = { l: 44, r: 12, t: 12, b: 22 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  container.querySelector("svg")?.remove();
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": opts.label ?? "Verlauf" });
  container.prepend(svg);
  const fmtY = opts.fmt ?? ((v) => nf.format(v));
  const fmtX = opts.xfmt ?? fmtTime;

  // robuste Y-Grenzen (einzelne Ausreißer beim Split abschneiden)
  const sorted = [...ys].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  const lo = opts.invert && ys.length > 20 ? q(0.02) : Math.min(opts.zero ? 0 : Infinity, sorted[0]);
  const hi = opts.invert && ys.length > 20 ? q(0.98) : sorted[sorted.length - 1];
  const ticks = niceTicks(lo, hi, 4);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const sx = (x) => (x1 === x0 ? m.l + iw / 2 : m.l + ((x - x0) / (x1 - x0)) * iw);
  const sy = (y) => {
    const v = Math.min(1, Math.max(0, (y - y0) / (y1 - y0 || 1)));
    return m.t + (opts.invert ? v : 1 - v) * ih;
  };

  const ax = el("g", { class: "axis" }, svg);
  for (const t of ticks) {
    el("line", { class: "gridline", x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t) }, ax);
    el("text", { x: m.l - 6, y: sy(t) + 4, "text-anchor": "end" }, ax).textContent = fmtY(t);
  }
  const nX = Math.max(2, Math.floor(iw / 80));
  let xt = [];
  if (opts.xfmt) {
    if (x1 > x0) for (let k = 0; k < nX; k++) xt.push(x0 + ((x1 - x0) * k) / (nX - 1));
    else xt = [x0];
  } else {
    const step = [10, 15, 30, 60, 120, 300, 600, 900, 1800].find((s) => s >= (x1 - x0) / nX) ?? 3600;
    for (let v = Math.ceil(x0 / step) * step; v <= x1; v += step) xt.push(v);
  }
  xt.forEach((t, k) => {
    const anchor = opts.xfmt && xt.length > 1 ? (k === 0 ? "start" : k === xt.length - 1 ? "end" : "middle") : "middle";
    el("text", { x: sx(t), y: H - 4, "text-anchor": anchor }, ax).textContent = fmtX(t);
  });

  // Hintergrundbänder (z. B. Pulszonen), dezent hinter der Linie
  for (const b of opts.bands ?? []) {
    const a = sy(Math.max(b.from, y0)), c = sy(Math.min(b.to, y1));
    if (b.to <= y0 || b.from >= y1) continue;
    el("rect", { x: m.l, width: iw, y: Math.min(a, c), height: Math.abs(a - c), style: `fill:${b.color};fill-opacity:.14` }, svg);
  }

  let d = "";
  xs.forEach((x, i) => { d += (i ? "L" : "M") + sx(x).toFixed(1) + "," + sy(ys[i]).toFixed(1); });
  el("path", { class: "line", d }, svg);
  if (opts.dots) xs.forEach((x, i) => el("circle", { class: "pt", cx: sx(x), cy: sy(ys[i]), r: 4 }, svg));

  // Hover: Fadenkreuz + Tooltip
  const xh = el("line", { class: "xhair", y1: m.t, y2: m.t + ih, visibility: "hidden" }, svg);
  const mk = el("circle", { class: "marker", r: 5, visibility: "hidden" }, svg);
  const hit = el("rect", { x: m.l - 8, y: 0, width: iw + 16, height: H, fill: "transparent" }, svg);
  const tip = tooltip(container);
  let cur = -1;
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let i = 0, bestD = Infinity;
    // nächster Punkt nach Bildschirmposition (funktioniert für unregelmäßige X-Abstände)
    let lo2 = 0, hi2 = xs.length - 1;
    while (hi2 - lo2 > 1) { const mid = (lo2 + hi2) >> 1; sx(xs[mid]) < px ? (lo2 = mid) : (hi2 = mid); }
    for (const k of [lo2, hi2]) { const dd = Math.abs(sx(xs[k]) - px); if (dd < bestD) { bestD = dd; i = k; } }
    cur = i;
    const cx = sx(xs[i]), cy = sy(ys[i]);
    xh.setAttribute("x1", cx); xh.setAttribute("x2", cx); xh.setAttribute("visibility", "visible");
    mk.setAttribute("cx", cx); mk.setAttribute("cy", cy); mk.setAttribute("visibility", "visible");
    tip.innerHTML = `<div class="t">${esc((opts.tipX ?? fmtX)(xs[i], i))}</div><b>${fmtY(ys[i])}</b> ${opts.unit ?? ""}`;
    const s = r.width / W, cr = container.getBoundingClientRect();
    placeTip(tip, container, cx * s + r.left - cr.left, cy * s + r.top - cr.top);
  };
  const leave = () => { xh.setAttribute("visibility", "hidden"); mk.setAttribute("visibility", "hidden"); tip.classList.add("hidden"); };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", leave);
  if (opts.onClick) { hit.style.cursor = "pointer"; hit.addEventListener("click", () => cur >= 0 && opts.onClick(cur)); }
}

// items: { value, short, tip, id? }
function barChart(container, items, opts = {}) {
  const W = Math.max(280, container.clientWidth), H = 170;
  const m = { l: 44, r: 6, t: 10, b: 22 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  container.querySelector("svg")?.remove();
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": opts.label ?? "Balkendiagramm" });
  container.prepend(svg);
  const fmtY = opts.fmt ?? ((v) => nf.format(v));
  const ticks = niceTicks(0, Math.max(1, ...items.map((d) => d.value)), 4);
  const top = ticks[ticks.length - 1];
  const sy = (v) => m.t + ih - (v / top) * ih;
  const ax = el("g", { class: "axis" }, svg);
  for (const t of ticks) {
    el("line", { class: "gridline", x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t) }, ax);
    el("text", { x: m.l - 6, y: sy(t) + 4, "text-anchor": "end" }, ax).textContent = fmtY(t);
  }
  const slot = iw / items.length, gap = 2, bw = Math.max(2, Math.min(36, slot - gap));
  const tip = tooltip(container);
  const labelEvery = Math.ceil(items.length / Math.max(1, Math.floor(iw / 48)));
  items.forEach((d, i) => {
    const x = m.l + i * slot + (slot - bw) / 2, y = sy(d.value), h = m.t + ih - y;
    if (h > 0) {
      const r = Math.min(4, bw / 2, h);
      const path = `M${x},${m.t + ih}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${m.t + ih}Z`;
      el("path", { class: "bar", d: path, "pointer-events": "none" }, svg);
    }
    // Trefferfläche über die ganze Spalte, damit auch kleine Balken antippbar sind
    const hit = el("rect", { x: m.l + i * slot, y: m.t, width: slot, height: ih, fill: "transparent", tabindex: 0, role: "button", "aria-label": d.tip.replace(/<[^>]+>/g, " ") }, svg);
    const show = () => {
      tip.innerHTML = d.tip;
      const sr = svg.getBoundingClientRect(), cr = container.getBoundingClientRect(), s = sr.width / W;
      placeTip(tip, container, (x + bw / 2) * s + sr.left - cr.left, y * s + sr.top - cr.top);
    };
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("focus", show);
    hit.addEventListener("pointerleave", () => tip.classList.add("hidden"));
    hit.addEventListener("blur", () => tip.classList.add("hidden"));
    if (opts.onClick && d.id) {
      hit.style.cursor = "pointer";
      hit.addEventListener("click", () => opts.onClick(d.id));
      hit.addEventListener("keydown", (e) => { if (e.key === "Enter") opts.onClick(d.id); });
    }
    if (i % labelEvery === 0) el("text", { x: x + bw / 2, y: H - 4, "text-anchor": "middle" }, ax).textContent = d.short;
  });
}

// ================= Verlauf =================
let sessions = [];
let current = null;

async function renderHistory() {
  sessions = await visibleSessions();
  const dist = sessions.reduce((a, s) => a + s.distance, 0);
  $("tCount").textContent = sessions.length;
  $("tDist").textContent = km(dist);
  $("tTime").textContent = fmtTime(sessions.reduce((a, s) => a + s.duration, 0));

  const list = $("sessionList");
  $("histChartWrap").classList.toggle("hidden", sessions.length === 0);
  if (!sessions.length) {
    list.innerHTML = `<div class="empty">Noch keine Einheiten. Verbinde dich im Tab „Live“ und leg los – oder probier den Demo-Modus.</div>`;
    return;
  }
  const loggedIn = !!cloud.user;
  list.innerHTML = `<table><thead><tr><th>Datum</th><th class="r">Distanz</th><th class="r">Zeit</th><th class="r">Ø Split</th><th class="r opt">Ø spm</th><th class="r opt">Ø Watt</th></tr></thead><tbody>${
    sessions.map((s) => `<tr class="click" data-id="${s.id}" tabindex="0"><td>${listDate.format(new Date(s.start))} <span class="time opt">${timeFmt.format(new Date(s.start))}</span>${loggedIn && !s.synced ? ' <span class="cloud-badge" title="Noch nicht in der Cloud">●</span>' : ""}</td><td class="r num">${nf.format(s.distance)} m</td><td class="r num">${fmtTime(s.duration)}</td><td class="r num">${fmtPace(s.avgPace)}</td><td class="r num opt">${(s.avgSpm ?? 0).toFixed(1)}</td><td class="r num opt">${Math.round(s.avgPower ?? 0)}</td></tr>`).join("")
  }</tbody></table>`;
  list.querySelectorAll("tr[data-id]").forEach((tr) => {
    tr.addEventListener("click", () => openDetail(+tr.dataset.id));
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") openDetail(+tr.dataset.id); });
  });

  if (currentView === "history") {
    const items = sessions.slice(0, 30).reverse().map((s) => ({
      id: s.id, value: s.distance, short: shortDate.format(new Date(s.start)),
      tip: `<div class="t">${dateFmt.format(new Date(s.start))}</div><b>${nf.format(s.distance)} m</b> · ${fmtTime(s.duration)}`,
    }));
    barChart($("histChart"), items, { onClick: openDetail, label: "Distanz pro Einheit" });
  }
}

function tile(label, value, unit = "", delta = "") {
  return `<div class="card tile"><div class="label">${label}</div><div class="value num">${value}${unit ? `<span class="unit">${unit}</span>` : ""}</div>${delta ? `<div class="delta num">${delta}</div>` : ""}</div>`;
}

async function openDetail(id) {
  showView("history", true);
  current = (await db.get(id)) ?? null;
  if (!current) return;
  $("historyList").classList.add("hidden");
  $("detail").classList.remove("hidden");
  window.scrollTo(0, 0);
  const s = current;
  $("dTitle").textContent = dateFmt.format(new Date(s.start));
  const b = s.bests ?? {};
  $("dTiles").innerHTML = [
    tile("Distanz", nf.format(s.distance), "m"),
    tile("Zeit", fmtTime(s.duration)),
    tile("Ø Split", fmtPace(s.avgPace), "/500 m"),
    tile("Ø Schlagfrequenz", (s.avgSpm ?? 0).toFixed(1), "spm"),
    tile("Ø Leistung", Math.round(s.avgPower ?? 0), "W"),
    tile("Max. Leistung", s.maxPower ?? 0, "W"),
    tile("Meter / Schlag", s.strokes ? (s.distance / s.strokes).toFixed(1) : "–", "m"),
    tile("Kalorien", s.kcal ?? 0, "kcal"),
    b[500] ? tile("Beste 500 m", fmtTime(b[500])) : "",
    b[1000] ? tile("Bester 1 km", fmtTime(b[1000])) : "",
    b[2000] ? tile("Beste 2 km", fmtTime(b[2000])) : "",
    b[5000] ? tile("Beste 5 km", fmtTime(b[5000])) : "",
  ].join("");

  // Messpunkte bei Bedarf aus der Cloud nachladen
  if (!s.samples && cloud.client && cloud.user) {
    const { data, error } = await cloud.client.from("sessions").select("samples").eq("id", s.id).single();
    if (!error && data) { s.samples = data.samples; await db.put(s); }
  }
  if (current !== s) return;
  $("dNoSamples").classList.toggle("hidden", !!s.samples);
  $("dCharts").classList.toggle("hidden", !s.samples);
  if (s.samples) drawDetailCharts(s);
}

function drawDetailCharts(s) {
  const mv = s.samples.filter((x) => x[3] > 0 && x[2] > 0);
  const t = mv.map((x) => x[0]);
  // gleitender Mittelwert über 5 Messungen, damit Schlag-zu-Schlag-Schwankungen den Trend nicht verdecken
  const smooth = (k) => mv.map((_, i) => {
    const w = mv.slice(Math.max(0, i - 2), i + 3);
    return Math.round((w.reduce((a, x) => a + x[k], 0) / w.length) * 10) / 10;
  });
  if (mv.length > 2) {
    lineChart($("dPace"), t, smooth(2).map(Math.round), { invert: true, fmt: fmtPace, unit: "/500 m", label: "Split-Verlauf" });
    lineChart($("dSpm"), t, smooth(3), { unit: "spm", label: "Schlagfrequenz", fmt: (v) => (Math.round(v * 10) / 10).toLocaleString("de-DE") });
    lineChart($("dPower"), t, smooth(4).map(Math.round), { zero: true, unit: "W", label: "Leistung" });
  }
  const hrS = s.samples.filter((x) => x[5] > 0);
  $("dHrWrap").classList.toggle("hidden", hrS.length < 3);
  renderZones($("dZones"), s.bests?.hrHist ?? hrHistogram(s.samples), "Zeit in Pulszonen");
  if (hrS.length >= 3) {
    const m = settings.maxHr;
    const bands = m ? ZONES.map((Z, k) => ({ from: Z.lo * m, to: k < 4 ? ZONES[k + 1].lo * m : 999, color: `var(--z${Z.n})` })) : [];
    lineChart($("dHr"), hrS.map((x) => x[0]), hrS.map((x) => x[5]), { unit: "bpm", label: "Herzfrequenz", bands });
  }
}

function closeDetail() {
  current = null;
  $("detail").classList.add("hidden");
  $("historyList").classList.remove("hidden");
  renderHistory();
}

async function deleteCurrent() {
  const s = current;
  if (!s || !confirm("Diese Einheit wirklich löschen?")) return;
  if (s.synced) {
    if (!cloud.client || !cloud.user) return alert("Diese Einheit liegt in der Cloud. Zum Löschen bitte anmelden.");
    const { error } = await cloud.client.from("sessions").delete().eq("id", s.id);
    if (error) return alert("Löschen fehlgeschlagen: " + error.message);
  }
  await db.del(s.id);
  closeDetail();
}

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportCsv(s) {
  if (!s.samples) return alert("Messpunkte noch nicht geladen.");
  const head = "zeit_s;distanz_m;split_s_500m;spm;watt;herzfrequenz;schlaege;kcal";
  download(`rudern_${s.start.slice(0, 16).replace(/[:T]/g, "-")}.csv`, [head, ...s.samples.map((x) => x.join(";"))].join("\n"), "text/csv");
}

// ================= Trends =================
function weekStart(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Montag
  return x;
}
function pctDelta(now, before) {
  if (!before) return now ? "neu" : "–";
  const p = Math.round(((now - before) / before) * 100);
  return p === 0 ? "= gleich" : `${p > 0 ? "▲" : "▼"} ${Math.abs(p)} % ${p > 0 ? "mehr" : "weniger"}`;
}

async function renderTrends() {
  const all = (await visibleSessions()).slice().reverse(); // alt -> neu
  const enough = all.length >= 2;
  $("trendsEmpty").classList.toggle("hidden", enough);
  $("trendsBody").classList.toggle("hidden", !enough);
  if (!enough || currentView !== "trends") return;

  // 4 Wochen vs. 4 Wochen davor
  const now = Date.now();
  const inRange = (a, b) => all.filter((s) => { const t = new Date(s.start).getTime(); return t > now - a * DAY && t <= now - b * DAY; });
  const cur = inRange(28, 0), prev = inRange(56, 28);
  const agg = (arr) => {
    const dist = arr.reduce((a, s) => a + s.distance, 0), dur = arr.reduce((a, s) => a + s.duration, 0);
    return { n: arr.length, dist, pace: dist ? (dur / dist) * 500 : 0 };
  };
  const A = agg(cur), B = agg(prev);
  const paceDelta = A.pace && B.pace ? Math.round(A.pace - B.pace) : null;
  $("trendTiles").innerHTML = [
    tile("Einheiten", A.n, "", B.n ? `vorher ${B.n}` : ""),
    tile("Distanz", km(A.dist), "km", pctDelta(A.dist, B.dist)),
    tile("Ø Split", fmtPace(A.pace), "", paceDelta === null ? "" : paceDelta === 0 ? "= gleich" : `${paceDelta < 0 ? "▲" : "▼"} ${Math.abs(paceDelta)} s ${paceDelta < 0 ? "schneller" : "langsamer"}`),
  ].join("");

  const hist4 = {};
  for (const s of cur) for (const [bpm, n] of Object.entries(s.bests?.hrHist ?? {})) hist4[bpm] = (hist4[bpm] || 0) + n;
  renderZones($("tZones"), hist4, "Zeit in Pulszonen <span>letzte 4 Wochen</span>");

  // km pro Woche, letzte 12 Wochen
  const w0 = weekStart(now).getTime();
  const weeks = [];
  for (let k = 11; k >= 0; k--) {
    const start = w0 - k * 7 * DAY;
    const inW = all.filter((s) => { const t = new Date(s.start).getTime(); return t >= start && t < start + 7 * DAY; });
    const dist = inW.reduce((a, s) => a + s.distance, 0);
    weeks.push({
      value: Math.round(dist / 100) / 10, short: shortDate.format(new Date(start)),
      tip: `<div class="t">Woche ab ${shortDate.format(new Date(start))}</div><b>${km(dist)} km</b> · ${inW.length} ${inW.length === 1 ? "Einheit" : "Einheiten"}`,
    });
  }
  barChart($("weekChart"), weeks, { fmt: (v) => v.toLocaleString("de-DE"), label: "Kilometer pro Woche" });

  // Split und Meter/Schlag je Einheit
  const withPace = all.filter((s) => s.avgPace > 0);
  const day = (s) => new Date(s.start).getTime() / DAY;
  const xDate = (x) => shortDate.format(new Date(x * DAY));
  const tipS = (arr) => (_x, i) => `${listDate.format(new Date(arr[i].start))} · ${nf.format(arr[i].distance)} m`;
  lineChart($("paceTrend"), withPace.map(day), withPace.map((s) => Math.round(s.avgPace)), {
    invert: true, fmt: fmtPace, unit: "/500 m", xfmt: xDate, tipX: tipS(withPace), dots: withPace.length <= 60,
    onClick: (i) => openDetail(withPace[i].id), label: "Durchschnittlicher Split pro Einheit",
  });
  const withMps = all.filter((s) => s.strokes > 0);
  lineChart($("mpsTrend"), withMps.map(day), withMps.map((s) => Math.round((s.distance / s.strokes) * 10) / 10), {
    unit: "m/Schlag", xfmt: xDate, tipX: tipS(withMps), dots: withMps.length <= 60,
    fmt: (v) => v.toLocaleString("de-DE", { maximumFractionDigits: 1 }),
    onClick: (i) => openDetail(withMps[i].id), label: "Meter pro Schlag",
  });

  // Bestleistungen
  const bestRow = (label, key, isDist) => {
    let best = null;
    for (const s of all) {
      const v = s.bests?.[key];
      if (v == null) continue;
      if (!best || (isDist ? v > best.v : v < best.v)) best = { v, s };
    }
    if (!best) return `<tr><td>${label}</td><td class="r muted" colspan="3">noch nicht erreicht</td></tr>`;
    const pace = isDist ? (1800 / best.v) * 500 : (best.v / key) * 500;
    return `<tr class="click" data-id="${best.s.id}" tabindex="0"><td>${label}</td><td class="r num"><b>${isDist ? nf.format(best.v) + " m" : fmtTime(best.v)}</b></td><td class="r num">${fmtPace(pace)}</td><td class="r num">${listDate.format(new Date(best.s.start))}</td></tr>`;
  };
  const longest = all.reduce((a, s) => (s.distance > (a?.distance ?? 0) ? s : a), null);
  $("bestsTable").innerHTML = `<table><thead><tr><th></th><th class="r">Bestwert</th><th class="r">Split</th><th class="r">Datum</th></tr></thead><tbody>
    ${bestRow("500 m", 500)}${bestRow("1.000 m", 1000)}${bestRow("2.000 m", 2000)}${bestRow("5.000 m", 5000)}${bestRow("30 Minuten", "30min", true)}
    ${longest ? `<tr class="click" data-id="${longest.id}" tabindex="0"><td>Längste Einheit</td><td class="r num"><b>${nf.format(longest.distance)} m</b></td><td class="r num">${fmtTime(longest.duration)}</td><td class="r num">${listDate.format(new Date(longest.start))}</td></tr>` : ""}
  </tbody></table>`;

  // Monate
  const months = new Map();
  for (const s of all) {
    const d = new Date(s.start), k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const m = months.get(k) ?? { d, n: 0, dist: 0, dur: 0 };
    m.n++; m.dist += s.distance; m.dur += s.duration;
    months.set(k, m);
  }
  $("monthTable").innerHTML = `<table><thead><tr><th>Monat</th><th class="r">Einheiten</th><th class="r">Distanz</th><th class="r">Zeit</th><th class="r">Ø Split</th></tr></thead><tbody>${
    [...months.values()].reverse().map((m) => `<tr><td>${monthFmt.format(m.d)}</td><td class="r num">${m.n}</td><td class="r num">${km(m.dist)} km</td><td class="r num">${fmtTime(m.dur)}</td><td class="r num">${fmtPace(m.dist ? (m.dur / m.dist) * 500 : 0)}</td></tr>`).join("")
  }</tbody></table>`;

  document.querySelectorAll("#bestsTable tr[data-id]").forEach((tr) => {
    tr.addEventListener("click", () => openDetail(+tr.dataset.id));
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") openDetail(+tr.dataset.id); });
  });
}

// ================= Konto =================
// Max-HF aus dem Konto übernehmen (gilt dann auf allen Geräten)
function adoptRemoteSettings() {
  const mh = cloud.user?.user_metadata?.max_hr;
  if (mh && mh !== settings.maxHr) {
    settings.maxHr = mh;
    try { localStorage.setItem("rudern-settings", JSON.stringify(settings)); } catch {}
  }
}

function renderSettings() {
  $("maxHrInput").value = settings.maxHr ?? "";
  $("zoneRanges").innerHTML = settings.maxHr
    ? ZONES.map((Z) => `<span style="white-space:nowrap"><span class="zone-badge" style="margin:0"><i style="--zc:${zoneColor(Z.n)}"></i></span> Z${Z.n} ${zoneRange(Z.n)}</span>`).join(" &nbsp; ")
    : "";
  document.querySelectorAll("#themeSeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.themeOpt === currentTheme()));
}

function renderAccount() {
  adoptRemoteSettings();
  renderSettings();
  const u = cloud.user;
  $("loggedOut").classList.toggle("hidden", !!u);
  $("loggedIn").classList.toggle("hidden", !u);
  if (u) $("accEmail").textContent = u.email;
  if (!cloud.client) {
    $("btnLogin").disabled = true;
    $("btnSignup").disabled = true;
  } else {
    $("btnLogin").disabled = false;
    $("btnSignup").disabled = false;
    $("cloudOffline").textContent = "";
  }
}

async function authAction(kind) {
  const email = $("authEmail").value.trim(), password = $("authPass").value;
  const msg = $("authMsg");
  if (!email || password.length < 8) { msg.textContent = "Bitte E-Mail und ein Passwort mit mindestens 8 Zeichen eingeben."; return; }
  msg.textContent = kind === "login" ? "Melde an …" : "Registriere …";
  const res = kind === "login"
    ? await cloud.client.auth.signInWithPassword({ email, password })
    : await cloud.client.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (res.error) {
    msg.textContent = res.error.message === "Invalid login credentials" ? "E-Mail oder Passwort falsch – oder die E-Mail ist noch nicht bestätigt."
      : res.error.message === "Email not confirmed" ? "Bitte zuerst den Link in der Bestätigungs-E-Mail öffnen, dann hier anmelden."
      : "Fehler: " + res.error.message;
    return;
  }
  if (kind === "signup" && !res.data.session) {
    msg.textContent = "Fast geschafft: Bestätigungs-E-Mail öffnen und den Link antippen. Danach hier mit E-Mail und Passwort anmelden.";
    return;
  }
  msg.textContent = "";
  $("authPass").value = "";
}

// ================= Navigation =================
let currentView = "live";
function showView(v, keepDetail = false) {
  currentView = v;
  document.querySelectorAll("nav button").forEach((b) => b.setAttribute("aria-selected", b.dataset.view === v));
  for (const name of ["live", "history", "trends", "account"]) $("view-" + name).classList.toggle("hidden", name !== v);
  if (v === "history" && !keepDetail) {
    if (current) { $("historyList").classList.add("hidden"); $("detail").classList.remove("hidden"); if (current.samples) drawDetailCharts(current); }
    else renderHistory();
  }
  if (v === "trends") renderTrends();
  if (v === "live") renderLive();
  if (v === "account") renderAccount();
}
function refreshViews() {
  renderHistory();
  if (currentView === "trends") renderTrends();
}
document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.view === "history" && currentView === "history" && current) closeDetail();
  showView(b.dataset.view);
}));

// ================= Verdrahtung =================
if (!navigator.bluetooth) $("noBt").classList.remove("hidden");
setStatus("idle", "Nicht verbunden");
$("btnConnect").addEventListener("click", connect);
$("btnDemo").addEventListener("click", startDemo);
$("btnHr").addEventListener("click", connectHr);
$("btnDisconnect").addEventListener("click", disconnect);
$("btnFinish").addEventListener("click", async () => {
  await finishManually();
  $("hint").textContent = "Einheit gespeichert. Die nächste startet automatisch beim nächsten Schlag.";
  renderLive();
});
$("btnBack").addEventListener("click", closeDetail);
$("btnCsv").addEventListener("click", () => current && exportCsv(current));
$("btnDelete").addEventListener("click", deleteCurrent);
$("authForm").addEventListener("submit", (e) => { e.preventDefault(); authAction("login"); });
$("btnSignup").addEventListener("click", () => authAction("signup"));
$("btnLogout").addEventListener("click", () => cloud.client?.auth.signOut());
$("btnSync").addEventListener("click", () => sync());
document.querySelectorAll("#themeSeg button").forEach((b) => b.addEventListener("click", () => applyTheme(b.dataset.themeOpt)));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(currentTheme()));
$("maxHrInput").addEventListener("change", (e) => {
  const v = Math.round(+e.target.value);
  settings.maxHr = v >= 120 && v <= 230 ? v : null;
  saveSettings();
  renderSettings();
  renderHr();
});
$("btnExportAll").addEventListener("click", async () => {
  download(`rudern_backup_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await visibleSessions()), "application/json");
});
$("fileImport").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    let n = 0;
    for (const s of data) {
      if (!s.id || !Array.isArray(s.samples)) continue;
      const existing = await db.get(s.id);
      if (existing) continue;
      summarize(s);
      await db.put({ ...s, owner: cloud.user?.id ?? null, synced: false });
      n++;
    }
    alert(`${n} Einheiten importiert.`);
    sync();
    refreshViews();
  } catch (err) { alert("Import fehlgeschlagen: " + err.message); }
  e.target.value = "";
});
window.addEventListener("pagehide", () => { if (session) saveSession(false); });
let rz;
window.addEventListener("resize", () => {
  clearTimeout(rz);
  rz = setTimeout(() => {
    if (currentView === "history" && current?.samples) drawDetailCharts(current);
    else showView(currentView);
  }, 150);
});

applyTheme(currentTheme());
renderSettings();
renderHistory();
initCloud();
