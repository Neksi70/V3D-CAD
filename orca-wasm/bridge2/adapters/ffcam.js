// Generischer Kamera-Puffer: hält je Quelle EINEN ffmpeg-Prozess offen und
// puffert das jeweils neueste JPEG (gleiches Muster wie camera.js für Bambu,
// aber mit frei wählbarer Eingangs-URL — RTSP der Kobra, FLV :18088, MJPEG …).
const { spawn } = require('child_process');

const cams = new Map();   // key -> { proc, latest, lastAccess, url, buf }
const IDLE_MS = 30000;

function ensure(key, url, inputArgs = []) {
  let c = cams.get(key);
  if (c && c.url === url && c.proc) { c.lastAccess = Date.now(); return c; }
  if (c && c.proc) { try { c.proc.kill('SIGKILL'); } catch {} }
  const proc = spawn('ffmpeg', [...inputArgs, '-i', url,
    '-an', '-r', '5', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '6', '-loglevel', 'error', 'pipe:1']);
  c = { proc, latest: null, lastAccess: Date.now(), url, buf: Buffer.alloc(0) };
  cams.set(key, c);
  proc.stdout.on('data', (d) => {
    c.buf = Buffer.concat([c.buf, d]);
    // letztes komplettes JPEG (FFD8 … FFD9) im Strom behalten
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
      c.buf = c.buf.subarray(lastEnd);
      if (c.buf.length > 4_000_000) c.buf = c.buf.subarray(c.buf.length - 1_000_000);
    }
  });
  proc.stderr.on('data', (d) => { const s = d.toString().trim(); if (s) console.log('[ffcam]', key, s.slice(0, 120)); });
  proc.on('exit', (code) => { console.log('[ffcam]', key, 'ffmpeg beendet', code); if (cams.get(key) === c) cams.delete(key); });
  return c;
}

// Neuestes Bild holen (startet ffmpeg bei Bedarf). null = noch keins da.
function snapshot(key, url, inputArgs) {
  const c = ensure(key, url, inputArgs);
  c.lastAccess = Date.now();
  return c.latest;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, c] of cams) if (now - c.lastAccess > IDLE_MS) { try { c.proc.kill('SIGKILL'); } catch {} cams.delete(key); }
}, 10000).unref?.();

module.exports = { snapshot };
