// Moonraker-Adapter (Klipper): Snapmaker U1 (Moonraker ab Werk, Port 80/7125)
// und generisch jeder Klipper-Drucker (Fluidd/Mainsail). HTTP-Polling statt
// WebSocket — passt zum Poll-Muster der Bridge und braucht keine Dependencies.
// U1-Spezifika (print_task_config = Filamente je Toolhead, Kamera monitor.jpg
// mit Wake-Keepalive) werden erkannt und genutzt, stören aber generische
// Klipper-Drucker nicht.

const PORT_DEFAULT = 7125;

function base(p) { return `http://${p.ip}:${p.port || PORT_DEFAULT}`; }

async function api(p, pathname, { method = 'GET', body, timeoutMs = 6000 } = {}) {
  const r = await fetch(base(p) + pathname, {
    method, body, signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`Moonraker ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// Klipper print_stats.state -> Bambu-artige Zustände, die die Web-App schon kennt
const STATE = { standby: 'IDLE', printing: 'RUNNING', paused: 'PAUSE',
                complete: 'FINISH', cancelled: 'IDLE', error: 'FAILED' };

const QUERY = ['print_stats', 'display_status', 'virtual_sdcard', 'heater_bed',
               'extruder', 'extruder1', 'extruder2', 'extruder3',
               'toolhead', 'fan', 'print_task_config'].join('&');

async function status(p) {
  const j = await api(p, `/printer/objects/query?${QUERY}`);
  const s = j.result.status;
  const ps = s.print_stats || {};
  const active = s.toolhead?.extruder || 'extruder';
  const noz = s[active] || s.extruder || {};
  const prog = s.virtual_sdcard?.is_active
    ? s.virtual_sdcard.progress
    : (s.display_status?.progress ?? s.virtual_sdcard?.progress);
  const percent = prog != null ? Math.round(prog * 100) : null;
  // Restzeit aus Fortschritt + bisheriger Druckzeit geschätzt (Minuten)
  let remaining = null;
  if (ps.state === 'printing' && prog > 0.01 && ps.print_duration > 0)
    remaining = Math.round(ps.print_duration * (1 - prog) / prog / 60);
  // U1: Filament je Toolhead als "Trays" (Farbe RRGGBBAA -> RRGGBB)
  const trays = [];
  const cfg = s.print_task_config;
  if (cfg?.filament_color_rgba) {
    cfg.filament_color_rgba.forEach((c, i) => trays.push({
      id: String(i), type: cfg.filament_type?.[i] || '', color: String(c).slice(0, 6),
    }));
  }
  return {
    online: true,
    state: STATE[ps.state] || (ps.state ? ps.state.toUpperCase() : 'IDLE'),
    subtask: ps.filename ? ps.filename.replace(/\.gcode$/i, '') : null,
    percent, remaining,
    layer: ps.info?.current_layer ?? null, total: ps.info?.total_layer ?? null,
    nozzle: noz.temperature ?? null, nozzle_target: noz.target ?? null,
    bed: s.heater_bed?.temperature ?? null, bed_target: s.heater_bed?.target ?? null,
    chamber: null,
    fan_part: s.fan?.speed != null ? Math.round(s.fan.speed * 100) : null,
    trays,
  };
}

async function control(p, command) {
  const g = { pause: 'PAUSE', resume: 'RESUME', stop: 'CANCEL_PRINT' }[command];
  if (!g) throw new Error(`Befehl "${command}" wird von diesem Drucker nicht unterstützt`);
  await api(p, `/printer/gcode/script?script=${encodeURIComponent(g)}`, { method: 'POST', timeoutMs: 20000 });
  return { ok: true };
}

// G-Code hochladen und optional starten. Upload via multipart, Start via
// SDCARD_PRINT_FILE (auf dem U1 hardware-verifizierter Weg).
async function send(p, filename, gcodeBuffer, start) {
  const fd = new FormData();
  fd.append('file', new Blob([gcodeBuffer], { type: 'text/plain' }), filename);
  await api(p, '/server/files/upload', { method: 'POST', body: fd, timeoutMs: 120000 });
  if (start) {
    await api(p, `/printer/gcode/script?script=${encodeURIComponent(
      `SDCARD_PRINT_FILE FILENAME="${filename}"`)}`, { method: 'POST', timeoutMs: 30000 });
  }
  return { ok: true, uploaded: filename, started: Boolean(start) };
}

// Kamera: U1 legt Snapshots unter /server/files/camera/monitor.jpg ab, schläft
// aber ohne Keepalive ein -> vor dem Abruf regelmäßig camera.start_monitor.
// Generische Klipper-Drucker: konfigurierbare Snapshot-URL (p.cam) oder
// Moonraker-Webcam-Liste.
const wakes = new Map();   // Drucker-id -> ts des letzten Keepalive
function wakeCamera(p) {
  // camera.start_monitor gibt es (je nach U1-Firmware) nur als WebSocket-
  // JSON-RPC; eine Antwort kommt teils nicht — Feuern und Schließen reicht.
  try {
    const ws = new WebSocket(`ws://${p.ip}:${p.port || PORT_DEFAULT}/websocket`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'camera.start_monitor',
                               params: { domain: 'lan', interval: 0 }, id: 1 }));
      setTimeout(() => { try { ws.close(); } catch {} }, 2000);
    };
    ws.onerror = () => {};
  } catch {}
}
async function snapshot(p) {
  const now = Date.now();
  if ((wakes.get(p.id) || 0) < now - 5000) {
    wakes.set(p.id, now);
    wakeCamera(p);
  }
  const urls = p.cam ? [p.cam] : [
    base(p) + '/server/files/camera/monitor.jpg',   // Snapmaker U1
    `http://${p.ip}/webcam/?action=snapshot`,       // crowsnest/ustreamer Standard
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(4000) });
      if (r.ok && (r.headers.get('content-type') || '').includes('image'))
        return Buffer.from(await r.arrayBuffer());
    } catch {}
  }
  return null;
}

// Erreichbarkeit: schneller /server/info-Check
async function online(p, timeoutMs = 2500) {
  try { await api(p, '/server/info', { timeoutMs }); return true; }
  catch { return false; }
}

module.exports = { status, control, send, snapshot, online };
