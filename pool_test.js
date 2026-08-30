'use strict';
/**
 * Prüft den OCCT-Arbeiterpool an dem, worauf es ankommt:
 * laufen mehrere Booleans wirklich gleichzeitig, staut sich der Rest sauber,
 * und wird ein zu dicker Arbeiter zwischen zwei Aufträgen ausgetauscht?
 */
const https = require('https');
const { spawn } = require('child_process');

const PORT = 3011, WORKERS = 3;
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Nutzlast: zwei überlappende Körper, ~3200 Dreiecke → ca. 3 s je Fuse ──
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
  for (const t of tris) {
    o += 12;
    for (const v of t) for (const k of v) { buf.writeFloatLE(k, o); o += 4; }
    o += 2;
  }
  return buf;
}
const A = stlBuf(sphere(40, 10, 0)).toString('base64');
const B = stlBuf(sphere(40, 10, 12)).toString('base64');
const RUMPF = JSON.stringify({ stlsBase64: [A, B] });

function auftrag(tag) {
  const t = Date.now();
  return new Promise((res) => {
    const r = https.request({
      method: 'POST', host: '127.0.0.1', port: PORT, path: '/api/occt-union',
      rejectUnauthorized: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(RUMPF) },
    }, (a) => {
      let d = '';
      a.on('data', (c) => (d += c));
      a.on('end', () => {
        let fehler = null;
        try { fehler = JSON.parse(d).error || null; } catch { fehler = 'Antwort kein JSON'; }
        res({ tag, ms: Date.now() - t, code: a.statusCode, worker: a.headers['x-occt-worker'],
              wartete: Number(a.headers['x-occt-wartezeit-ms'] || 0), fehler });
      });
    });
    r.on('error', (e) => res({ tag, ms: Date.now() - t, fehler: e.message }));
    r.write(RUMPF); r.end();
  });
}

const zustandRoh = () => new Promise((res) => {
  const r = https.get({ host: '127.0.0.1', port: PORT, path: '/pool', rejectUnauthorized: false }, (a) => {
    let d = ''; a.on('data', (c) => (d += c)); a.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
  });
  r.on('error', () => res(null));
  r.setTimeout(5000, () => { r.destroy(); res(null); });
});
// Eine einzelne Abfrage kann an einer abgeräumten TLS-Verbindung scheitern,
// während gerade Arbeiter ausgetauscht werden. Das ist kein Pool-Fehler.
async function zustand(versuche = 3) {
  for (let i = 0; i < versuche; i++) {
    const z = await zustandRoh();
    if (z) return z;
    await schlaf(400);
  }
  return null;
}

(async () => {
  const pool = spawn(process.execPath, ['occt-pool.js'], {
    cwd: __dirname,
    env: { ...process.env, OCCT_POOL_PORT: String(PORT), OCCT_WORKER_PORT: '3111',
           OCCT_WORKERS: String(WORKERS),
           // Standardmässig aus, damit der Parallelitäts-Test nicht von
           // Neustarts überlagert wird. Der Erneuerungs-Test setzt sie klein.
           OCCT_RSS_LIMIT_MB: process.env.RSS_LIMIT || '100000',
           OCCT_MAX_JOBS: process.env.MAX_JOBS || '1000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  pool.stdout.on('data', (d) => logs.push(String(d)));
  pool.stderr.on('data', (d) => logs.push(String(d)));

  try {
    process.stdout.write('Arbeiter starten');
    for (let i = 0; i < 120; i++) {
      const z = await zustand();
      if (z && z.arbeiter.filter((w) => w.zustand === 'frei').length === WORKERS) break;
      process.stdout.write('.'); await schlaf(1000);
    }
    const z0 = await zustand();
    console.log('\n\n── Start ──');
    console.log(`${WORKERS} Arbeiter bereit, RSS je: ${z0.arbeiter.map((w) => w.rssMB + ' MB').join(', ')}`);

    console.log('\n── 1 Auftrag allein (Basiszeit) ──');
    const e = await auftrag('einzeln');
    console.log(`  ${e.ms} ms  (Arbeiter ${e.worker}${e.fehler ? ', FEHLER: ' + e.fehler : ''})`);
    const T = e.ms;

    console.log(`\n── ${WORKERS} Aufträge gleichzeitig ──`);
    let t0 = Date.now();
    let r = await Promise.all(Array.from({ length: WORKERS }, (_, i) => auftrag('p' + i)));
    let wand = Date.now() - t0;
    r.forEach((x) => console.log(`  ${String(x.ms).padStart(6)} ms  Arbeiter ${x.worker}  wartete ${x.wartete} ms${x.fehler ? '  FEHLER: ' + x.fehler : ''}`));
    console.log(`  Wanduhr gesamt: ${wand} ms   (seriell wären ~${T * WORKERS} ms)`);
    console.log(`  verschiedene Arbeiter benutzt: ${new Set(r.map((x) => x.worker)).size} von ${WORKERS}`);
    const parallel = wand < T * WORKERS * 0.6;
    console.log(`  => läuft parallel: ${parallel ? 'JA ✓' : 'NEIN ✗'}`);

    const N = WORKERS + 2;
    console.log(`\n── ${N} Aufträge auf ${WORKERS} Arbeiter (Überlauf muss in die Schlange) ──`);
    t0 = Date.now();
    r = await Promise.all(Array.from({ length: N }, (_, i) => auftrag('q' + i)));
    wand = Date.now() - t0;
    r.forEach((x) => console.log(`  ${String(x.ms).padStart(6)} ms  Arbeiter ${x.worker}  wartete ${String(x.wartete).padStart(5)} ms${x.fehler ? '  FEHLER: ' + x.fehler : ''}`));
    const gewartet = r.filter((x) => x.wartete > 500).length;
    console.log(`  Wanduhr gesamt: ${wand} ms, ${gewartet} Aufträge haben gewartet`);
    // Bei eingeschalteter Erneuerung warten mehr Aufträge, weil ein gerade
    // ausgetauschter Arbeiter kurz nicht zur Verfügung steht — das ist richtig.
    const erwartet = N - WORKERS, streng = !process.env.RSS_LIMIT && !process.env.MAX_JOBS;
    const ok = streng ? gewartet === erwartet : gewartet >= erwartet;
    console.log(`  => Schlange greift: ${ok ? 'JA ✓' : 'NEIN ✗ (' + gewartet + ' statt ' + erwartet + ')'}`);
    console.log(`  => alle erfolgreich: ${r.every((x) => !x.fehler) ? 'JA ✓' : 'NEIN ✗'}`);

    const z1 = await zustand();
    console.log(`\n── Zustand danach ──`);
    if (!z1) { console.log('  /pool nicht erreichbar'); return; }
    console.log(`  erledigt=${z1.erledigt} abgewiesen=${z1.abgewiesen} neugestartet=${z1.neugestartet} maxSchlange=${z1.maxSchlange}`);
    z1.arbeiter.forEach((w) => console.log(`  Arbeiter ${w.id}: ${w.zustand}, ${w.auftraege} Aufträge, ${w.rssMB} MB`));
  } finally {
    pool.kill('SIGTERM');
    await schlaf(2000);
    try { pool.kill('SIGKILL'); } catch {}
    if (process.env.POOL_LOG) console.log('\n── Pool-Ausgabe ──\n' + logs.join(''));
  }
})();
