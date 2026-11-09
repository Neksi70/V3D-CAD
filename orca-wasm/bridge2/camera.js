// Kamera-Manager: hält je Drucker EINE RTSP-Verbindung (ffmpeg) offen und
// puffert das jeweils neueste JPEG im Speicher. Der Browser holt Einzelbilder
// per Polling ab — das läuft robust durch Reverse-Proxys (Tailscale), anders
// als ein fortlaufender MJPEG-Stream, der dort gepuffert wird.
const { spawn } = require('child_process');

const cams = new Map();   // ip -> { proc, latest:Buffer|null, lastAccess, code }
const IDLE_MS = 30000;    // ffmpeg beenden, wenn 30 s niemand mehr abruft

function ensure(ip, code) {
  let c = cams.get(ip);
  if (c && c.code === code && c.proc) { c.lastAccess = Date.now(); return c; }
  if (c && c.proc) { try { c.proc.kill('SIGKILL'); } catch {} }
  const url = `rtsps://bblp:${code}@${ip}:322/streaming/live/1`;
  const proc = spawn('ffmpeg', ['-rtsp_transport', 'tcp', '-i', url,
    '-an', '-r', '5', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '6', '-loglevel', 'error', 'pipe:1']);
  c = { proc, latest: null, lastAccess: Date.now(), code, buf: Buffer.alloc(0) };
  cams.set(ip, c);
  proc.stdout.on('data', (d) => {
    c.buf = Buffer.concat([c.buf, d]);
    // JPEGs im Strom: Start FFD8 … Ende FFD9 — jeweils letztes komplettes Bild behalten
    let start = c.buf.indexOf(Buffer.from([0xFF, 0xD8]));
    let lastEnd = -1, lastStart = -1;
    while (start !== -1) {
      const end = c.buf.indexOf(Buffer.from([0xFF, 0xD9]), start + 2);
      if (end === -1) break;
      lastStart = start; lastEnd = end + 2;
      start = c.buf.indexOf(Buffer.from([0xFF, 0xD8]), end + 2);
    }
    if (lastEnd !== -1) {
      c.latest = c.buf.subarray(lastStart, lastEnd);
      c.buf = c.buf.subarray(lastEnd);        // Rest (angefangenes nächstes Bild) behalten
      if (c.buf.length > 4_000_000) c.buf = c.buf.subarray(c.buf.length - 1_000_000);
    }
  });
  proc.stderr.on('data', (d) => { const s = d.toString().trim(); if (s) console.log('[cam]', ip, s.slice(0, 120)); });
  proc.on('exit', (code2) => { console.log('[cam]', ip, 'ffmpeg beendet', code2); if (cams.get(ip) === c) cams.delete(ip); });
  return c;
}

// Neuestes Bild holen (startet die Verbindung bei Bedarf). null = noch keins da.
function snapshot(ip, code) {
  const c = ensure(ip, code);
  c.lastAccess = Date.now();
  return c.latest;
}

// Idle-Kameras aufräumen
setInterval(() => {
  const now = Date.now();
  for (const [ip, c] of cams) if (now - c.lastAccess > IDLE_MS) { try { c.proc.kill('SIGKILL'); } catch {} cams.delete(ip); }
}, 10000).unref?.();

module.exports = { snapshot };
