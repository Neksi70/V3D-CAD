'use strict';
/**
 * Der Fall, der früher als „hängt bei 85 %" endete: der OCCT-Prozess stirbt
 * mitten in der Rechnung (WASM-Trap, OOM-Killer). Vorher blieb der Browser
 * stumm hängen, bis irgendein Zeitlimit zuschlug.
 *
 * Geprüft wird hier dreierlei:
 *   1. Der Kunde bekommt zügig eine verständliche Fehlermeldung.
 *   2. Der Pool startet den toten Arbeiter von selbst nach.
 *   3. Der nächste Auftrag läuft wieder durch.
 */
const https = require('https');
const { spawn } = require('child_process');

const PORT = 3021;
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

function sphere(seg, r, cx) {
  const tris = [], P = (i, j) => {
    const th = Math.PI * i / seg, ph = 2 * Math.PI * j / seg;
    return [cx + r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)];
  };
  for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    tris.push([a, b, c], [a, c, d]);
  }
  return tris;
}
function stlBuf(tris) {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  let o = 84;
  for (const t of tris) { o += 12; for (const v of t) for (const k of v) { buf.writeFloatLE(k, o); o += 4; } o += 2; }
  return buf;
}
const RUMPF = JSON.stringify({
  stlsBase64: [stlBuf(sphere(40, 10, 0)).toString('base64'),
               stlBuf(sphere(40, 10, 12)).toString('base64')] });

function auftrag() {
  const t = Date.now();
  return new Promise((res) => {
    const r = https.request({
      method: 'POST', host: '127.0.0.1', port: PORT, path: '/api/occt-union',
      rejectUnauthorized: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(RUMPF) },
    }, (a) => {
      let d = ''; a.on('data', (c) => (d += c));
      a.on('end', () => { let j = {}; try { j = JSON.parse(d); } catch {}
        res({ ms: Date.now() - t, code: a.statusCode, fehler: j.error || null, tris: j.trisBase64 ? 'ja' : (j.stlBase64 ? 'ja' : '?') }); });
    });
    r.on('error', (e) => res({ ms: Date.now() - t, code: 0, fehler: 'Verbindung: ' + e.message }));
    r.write(RUMPF); r.end();
  });
}
const zustand = () => new Promise((res) => {
  const r = https.get({ host: '127.0.0.1', port: PORT, path: '/pool', rejectUnauthorized: false }, (a) => {
    let d = ''; a.on('data', (c) => (d += c)); a.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
  });
  r.on('error', () => res(null));
  r.setTimeout(5000, () => { r.destroy(); res(null); });
});

(async () => {
  const pool = spawn(process.execPath, ['occt-pool.js'], {
    cwd: __dirname,
    env: { ...process.env, OCCT_POOL_PORT: String(PORT), OCCT_WORKER_PORT: '3121',
           OCCT_WORKERS: '1', OCCT_RSS_LIMIT_MB: '100000', OCCT_MAX_JOBS: '1000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pool.stdout.on('data', (d) => process.env.POOL_LOG && process.stdout.write(String(d)));
  pool.stderr.on('data', (d) => process.env.POOL_LOG && process.stderr.write(String(d)));

  try {
    for (let i = 0; i < 90; i++) {
      const z = await zustand();
      if (z && z.arbeiter.some((w) => w.zustand === 'frei')) break;
      await schlaf(1000);
    }
    console.log('Arbeiter bereit.\n');

    // Auftrag losschicken und ihm nach 4 s den Prozess unter dem Hintern wegziehen
    const läuft = auftrag();
    await schlaf(4000);
    // PID kommt vom Pool selbst. Ein pgrep auf 'occt-server.js' würde auch den
    // produktiven Dienst treffen — der läuft auf derselben Maschine.
    const vorher = await zustand();
    const beschaeftigt = (vorher.arbeiter || []).find((w) => w.zustand === 'beschaeftigt');
    if (!beschaeftigt || !beschaeftigt.pid) { console.log('Kein beschäftigter Arbeiter gefunden — Test abgebrochen'); return; }
    console.log(`── Arbeiter ${beschaeftigt.id} (PID ${beschaeftigt.pid}) wird mitten im Auftrag hart abgeschossen ──`);
    process.kill(beschaeftigt.pid, 'SIGKILL');

    const e = await läuft;
    console.log(`  Antwort nach ${e.ms} ms, HTTP ${e.code}`);
    console.log(`  Meldung: ${e.fehler || '(keine)'}`);
    const schnell = e.ms < 30000, verstaendlich = !!e.fehler && e.code >= 500;
    console.log(`  => keine Hängepartie (< 30 s): ${schnell ? 'JA ✓' : 'NEIN ✗'}`);
    console.log(`  => verständliche Fehlermeldung: ${verstaendlich ? 'JA ✓' : 'NEIN ✗'}`);

    console.log('\n── Erholt sich der Pool von selbst? ──');
    let wieder = false;
    for (let i = 0; i < 60; i++) {
      const z = await zustand();
      if (z && z.arbeiter.some((w) => w.zustand === 'frei')) { wieder = true; break; }
      await schlaf(1000);
    }
    console.log(`  => Arbeiter wieder da: ${wieder ? 'JA ✓' : 'NEIN ✗'}`);

    const n = await auftrag();
    console.log(`  => nächster Auftrag läuft: ${!n.fehler ? 'JA ✓' : 'NEIN ✗ (' + n.fehler + ')'} (${n.ms} ms)`);

    const z = await zustand();
    if (z) console.log(`\n  erledigt=${z.erledigt} neugestartet=${z.neugestartet}`);
  } finally {
    pool.kill('SIGTERM');
    await schlaf(1500);
    try { pool.kill('SIGKILL'); } catch {}
  }
})();
