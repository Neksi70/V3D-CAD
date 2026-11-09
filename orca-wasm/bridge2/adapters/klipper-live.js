// Klipper-Live-Steuerung (V3D Druck-Assistent): Werte WÄHREND des Drucks nachregeln + eigene
// Profile in der Moonraker-Datenbank (Namespace "v3d"). Für Snapmaker U1 gebaut, läuft mit jedem
// Klipper/Moonraker.
//
// Sicherheit: Der Browser schickt NIE G-Code, nur Wunschwerte {speed: 110, flow: 103, …}.
// Hier wird jeder Wert geprüft, auf feste Grenzen geklemmt und erst dann in einen Klipper-Befehl
// übersetzt (WHITELIST). Temperatur-Sprünge während des Drucks sind zusätzlich begrenzt.
//
// Am U1 nachgeprüft (24.10.2026, nur lesend): config-Root ist nur lesbar (keine printer.cfg-Makros),
// Befehle SET_PRESSURE_ADVANCE, SET_VELOCITY_LIMIT, SET_HEATER_TEMPERATURE, SET_FAN_SPEED vorhanden,
// gcode_move.speed_factor/extrude_factor, extruder.pressure_advance/smooth_time, toolhead.max_velocity/
// max_accel/square_corner_velocity lesbar; 4 Extruder (extruder, extruder1..3), aktiver = toolhead.extruder.

const PORT_DEFAULT = 7125;
const base = (p) => `http://${p.ip}:${p.port || PORT_DEFAULT}`;
async function api(p, pathname, { method = 'GET', body, timeoutMs = 6000 } = {}) {
  const opt = { method, signal: AbortSignal.timeout(timeoutMs) };
  if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers = { 'Content-Type': 'application/json' }; }
  const r = await fetch(base(p) + pathname, opt);
  const txt = await r.text();
  if (!r.ok) { const e = new Error(`Moonraker ${r.status}: ${txt.slice(0, 200)}`); e.status = r.status; throw e; }
  return txt ? JSON.parse(txt) : {};
}

// ---- Stellgrößen: Grenzen + Befehl --------------------------------------------------------------
// min/max = absolute Grenzen; jump = größter Sprung je Änderung WÄHREND eines Drucks (relativ zum
// aktuellen Wert), damit ein Vertipper (z. B. 25 statt 250 °C) den Druck nicht zerstört.
const KNOBS = {
  speed:  { label: 'Geschwindigkeit', unit: '%',    min: 20,  max: 200,  step: 5,     jump: 60,
            cmd: (v) => `M220 S${v}` },
  flow:   { label: 'Fluss (Flow)',    unit: '%',    min: 85,  max: 115,  step: 1,     jump: 10,
            cmd: (v) => `M221 S${v}` },
  nozzle: { label: 'Düsentemperatur', unit: '°C',   min: 170, max: 300,  step: 1,     jump: 20, heater: true,
            cmd: (v, L) => `SET_HEATER_TEMPERATURE HEATER=${L.extruder} TARGET=${v}` },
  bed:    { label: 'Betttemperatur',  unit: '°C',   min: 0,   max: 110,  step: 1,     jump: 20, heater: true,
            cmd: (v) => `SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=${v}` },
  fan:    { label: 'Bauteillüfter',   unit: '%',    min: 0,   max: 100,  step: 5,     jump: 100,
            cmd: (v) => `M106 S${Math.round(v * 2.55)}` },
  pa:     { label: 'Pressure Advance', unit: '',    min: 0,   max: 0.2,  step: 0.002, jump: 0.05, dec: 3,
            cmd: (v, L) => `SET_PRESSURE_ADVANCE EXTRUDER=${L.extruder} ADVANCE=${v}` },
  accel:  { label: 'Beschleunigung',  unit: 'mm/s²', min: 500, max: 20000, step: 500, jump: 20000,
            cmd: (v) => `SET_VELOCITY_LIMIT ACCEL=${v}` },
  velocity: { label: 'Max. Geschwindigkeit', unit: 'mm/s', min: 20, max: 600, step: 10, jump: 600,
            cmd: (v) => `SET_VELOCITY_LIMIT VELOCITY=${v}` },
  scv:    { label: 'Eckengeschwindigkeit (SCV)', unit: 'mm/s', min: 1, max: 20, step: 0.5, jump: 20, dec: 1,
            cmd: (v) => `SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=${v}` },
};

const QUERY = ['print_stats', 'virtual_sdcard', 'display_status', 'gcode_move', 'toolhead', 'fan', 'heater_bed',
  'extruder', 'extruder1', 'extruder2', 'extruder3', 'print_task_config'].join('&');

// Live-Zustand lesen → flache Werte in denselben Einheiten wie KNOBS
async function readLive(p) {
  const s = (await api(p, `/printer/objects/query?${QUERY}`)).result.status;
  const ps = s.print_stats || {}, tl = s.toolhead || {}, gm = s.gcode_move || {};
  const extruder = /^extruder\d*$/.test(tl.extruder || '') ? tl.extruder : 'extruder';
  const ex = s[extruder] || {};
  const tool = extruder === 'extruder' ? 0 : Number(extruder.slice(8)) || 0;
  const ptc = s.print_task_config || {};
  const r1 = (v, d = 0) => v == null ? null : Math.round(v * 10 ** d) / 10 ** d;
  const prog = s.virtual_sdcard?.is_active ? s.virtual_sdcard.progress : (s.display_status?.progress ?? s.virtual_sdcard?.progress);
  return {
    state: ps.state || 'standby', printing: ps.state === 'printing' || ps.state === 'paused',
    file: ps.filename || null, percent: prog != null ? Math.round(prog * 100) : null,
    layer: ps.info?.current_layer ?? null, total: ps.info?.total_layer ?? null,
    extruder, tool,
    material: (ptc.filament_type || [])[tool] || null,
    values: {
      speed: r1((gm.speed_factor ?? 1) * 100), flow: r1((gm.extrude_factor ?? 1) * 100),
      nozzle: r1(ex.target), bed: r1(s.heater_bed?.target),
      fan: s.fan?.speed != null ? r1(s.fan.speed * 100) : null,
      pa: r1(ex.pressure_advance, 4),
      accel: r1(tl.max_accel), velocity: r1(tl.max_velocity), scv: r1(tl.square_corner_velocity, 1),
    },
    temps: { nozzle: r1(ex.temperature, 1), bed: r1(s.heater_bed?.temperature, 1) },
  };
}

// Wunschwerte prüfen/klemmen → Befehle. live = Ergebnis von readLive.
// Rückgabe { lines: [...G-Code], applied: {key: wert}, notes: [...] }; wirft bei Unsinn.
function planChanges(live, wish) {
  const lines = [], applied = {}, notes = [];
  for (const [key, raw] of Object.entries(wish || {})) {
    const k = KNOBS[key];
    if (!k) throw new Error(`unbekannte Stellgröße: ${key}`);
    let v = Number(raw);
    if (!Number.isFinite(v)) throw new Error(`${k.label}: keine Zahl`);
    const want = v;
    v = Math.min(k.max, Math.max(k.min, v));
    // Heizungen dürfen auf 0 (aus) – sonst gelten die Mindestwerte
    if (k.heater && want === 0) v = 0;
    if (key === 'nozzle' && want === 0 && live.printing) throw new Error('Düse ausschalten während des Drucks ist gesperrt – erst Druck anhalten');
    const cur = live.values[key];
    if (live.printing && Number.isFinite(cur) && cur > 0 && Math.abs(v - cur) > k.jump) {
      v = cur + Math.sign(v - cur) * k.jump;
      notes.push(`${k.label}: Sprung während des Drucks auf ${k.jump}${k.unit ? ' ' + k.unit : ''} begrenzt`);
    }
    const d = k.dec ?? 0;
    v = Math.round(v * 10 ** d) / 10 ** d;
    if (v !== want && !notes.some(n => n.startsWith(k.label))) notes.push(`${k.label}: auf ${v}${k.unit ? ' ' + k.unit : ''} begrenzt (erlaubt ${k.min}–${k.max})`);
    lines.push(k.cmd(v, live));
    applied[key] = v;
  }
  return { lines, applied, notes };
}

async function applyChanges(p, wish) {
  const live = await readLive(p);
  const plan = planChanges(live, wish);
  if (!plan.lines.length) return { ...plan, live };
  await api(p, `/printer/gcode/script?script=${encodeURIComponent(plan.lines.join('\n'))}`, { method: 'POST', timeoutMs: 20000 });
  return { ...plan, live: await readLive(p).catch(() => live) };
}

// ---- Hilfe nach Druckproblem: konkrete, kleine Schritte relativ zu den aktuellen Werten ----------
const PROBLEMS = {
  stringing:  { label: 'Fäden ziehen (Stringing)', why: 'Kühler drucken und mehr Pressure Advance verringern das Nachlaufen der Düse.',
                plan: (v) => ({ nozzle: v.nozzle - 5, pa: v.pa != null ? v.pa + 0.004 : undefined }) },
  underext:   { label: 'Lücken / zu wenig Material', why: 'Etwas mehr Fluss und wärmer drucken; wenn es nur bei schnellen Stellen auftritt, hilft langsamer.',
                plan: (v) => ({ flow: v.flow + 3, nozzle: v.nozzle + 5 }) },
  overext:    { label: 'Zu viel Material / Kleckse', why: 'Weniger Fluss, die Wände werden sauberer.',
                plan: (v) => ({ flow: v.flow - 3 }) },
  ghosting:   { label: 'Wellen an Kanten (Ghosting)', why: 'Weniger Beschleunigung und Eckengeschwindigkeit glätten die Schwingungen.',
                plan: (v) => ({ accel: Math.round(v.accel * 0.7 / 500) * 500, scv: Math.max(2, (v.scv || 5) - 2) }) },
  corners:    { label: 'Ecken bauchig / Kanten rund', why: 'Mehr Pressure Advance baut den Druck in der Düse vor Ecken schneller ab.',
                plan: (v) => ({ pa: v.pa != null ? v.pa + 0.006 : undefined }) },
  overhang:   { label: 'Überhänge hängen durch', why: 'Mehr Kühlung und etwas langsamer – die Bahnen erstarren schneller.',
                plan: (v) => ({ fan: Math.min(100, (v.fan || 0) + 20), speed: v.speed - 15 }) },
  adhesion:   { label: 'Löst sich vom Bett / Warping', why: 'Wärmeres Bett und weniger Lüfter halten die unteren Schichten warm.',
                plan: (v) => ({ bed: v.bed + 5, fan: Math.max(0, (v.fan || 0) - 20) }) },
  layers:     { label: 'Schichten halten schlecht', why: 'Wärmer und weniger Kühlung verschweißen die Schichten besser.',
                plan: (v) => ({ nozzle: v.nozzle + 10, fan: Math.max(0, (v.fan || 0) - 20) }) },
  faster:     { label: 'Läuft gut – schneller', why: 'Das Teil läuft sauber: 15 % schneller spart Zeit; bei Problemen zurück.',
                plan: (v) => ({ speed: v.speed + 15 }) },
};
function suggest(live, problem) {
  const P = PROBLEMS[problem];
  if (!P) throw new Error('unbekanntes Problem');
  const raw = P.plan(live.values);
  const wish = {};
  // Heizungen, die aus sind (Ziel 0), nie über einen Vorschlag einschalten
  for (const [k, v] of Object.entries(raw)) if (v != null && Number.isFinite(v) && live.values[k] != null && !(KNOBS[k].heater && !live.values[k])) wish[k] = v;
  const plan = planChanges(live, wish);
  return { problem, label: P.label, why: P.why, wish: plan.applied, notes: plan.notes,
           rows: Object.entries(plan.applied).map(([k, v]) => ({ key: k, label: KNOBS[k].label, unit: KNOBS[k].unit, from: live.values[k], to: v })) };
}

// ---- Profile in der Moonraker-Datenbank (Namespace "v3d", Schlüssel "profiles") ------------------
const NS = 'v3d', KEY = 'profiles';
async function listProfiles(p) {
  try { return (await api(p, `/server/database/item?namespace=${NS}&key=${KEY}`)).result?.value || {}; }
  catch (e) { if (e.status === 404) return {}; throw e; }
}
function cleanName(n) {
  const s = String(n || '').replace(/[^\p{L}\p{N} ._+\-()]/gu, '').trim().slice(0, 60);
  if (!s) throw new Error('Profilname fehlt');
  return s;
}
async function saveProfile(p, name, { values, material, note } = {}) {
  name = cleanName(name);
  const live = await readLive(p);
  const src = values || live.values, keep = {};
  for (const k of Object.keys(KNOBS)) if (src[k] != null && Number.isFinite(Number(src[k]))) keep[k] = Number(src[k]);
  for (const k of ['nozzle', 'bed']) if (keep[k] === 0) delete keep[k];   // „Heizung aus“ ist kein Profilwert
  if (!Object.keys(keep).length) throw new Error('keine Werte zum Speichern');
  planChanges({ ...live, printing: false }, keep);   // gleiche Grenzen wie beim Anwenden (wirft bei Unsinn)
  const all = await listProfiles(p);
  all[name] = { values: keep, material: material ?? live.material, note: note ? String(note).slice(0, 200) : undefined,
                saved: new Date().toISOString(), by: 'V3D Druck-Assistent' };
  await api(p, '/server/database/item', { method: 'POST', body: { namespace: NS, key: KEY, value: all } });
  return all;
}
async function deleteProfile(p, name) {
  const all = await listProfiles(p);
  if (!(name in all)) throw new Error('Profil nicht gefunden');
  delete all[name];
  await api(p, '/server/database/item', { method: 'POST', body: { namespace: NS, key: KEY, value: all } });
  return all;
}
async function applyProfile(p, name, { skip = [] } = {}) {
  const all = await listProfiles(p);
  const pr = all[name]; if (!pr) throw new Error('Profil nicht gefunden');
  // Ohne laufenden Druck heizt ein Profil nicht auf – Temperaturen gelten erst, wenn gedruckt wird
  const live = await readLive(p), wish = {}, held = [];
  for (const [k, v] of Object.entries(pr.values || {})) {
    if (skip.includes(k)) continue;
    if (KNOBS[k]?.heater && !live.printing) { held.push(KNOBS[k].label); continue; }
    wish[k] = v;
  }
  const r = await applyChanges(p, wish);
  if (held.length) r.notes.push(`${held.join(' und ')} nicht gesetzt – es läuft kein Druck (heizt sonst unbeaufsichtigt auf)`);
  return r;
}

module.exports = { KNOBS, PROBLEMS, readLive, planChanges, applyChanges, suggest, listProfiles, saveProfile, deleteProfile, applyProfile };
