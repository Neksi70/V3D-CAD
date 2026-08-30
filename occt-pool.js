'use strict';
/**
 * OCCT-Arbeiterpool — Verteiler vor mehreren occt-server.js-Prozessen.
 *
 * Warum es das gibt (gemessen, nicht vermutet):
 *   • Eine OCCT-Operation belastet genau EINEN Kern und skaliert linear mit
 *     der Dreieckszahl: ~1 ms je Dreieck (6.272 Dreiecke = 6,1 s).
 *   • Eine einzelne WASM-Instanz arbeitet strikt nacheinander. Zwei Nutzer
 *     gleichzeitig hiessen bisher: der zweite wartet, komplett.
 *   • Der Prozess gibt Speicher nicht zurueck — nach 5,8 Tagen Betrieb
 *     standen 4,03 GB RSS, obwohl der WASM-Heap bei 1,4 GB recycelt wird.
 *
 * Der Pool nimmt sich beides vor: er haelt mehrere Arbeiter und verteilt
 * jeden Auftrag an einen freien (nicht reihum — ein Arbeiter, der gerade an
 * einem 6-Minuten-Boolean sitzt, bekommt nichts Neues), und er tauscht einen
 * Arbeiter aus, sobald der zu viel Speicher haelt oder genug Auftraege
 * gesehen hat. Der Austausch passiert zwischen zwei Auftraegen, nie mitten
 * in einem.
 *
 * Nach aussen unveraendert: HTTPS auf 3001, gleiche Routen, gleiche
 * Antworten. volme3d_server.py muss nichts wissen.
 */

const fs    = require('fs');
const os    = require('os');
const http  = require('http');
const https = require('https');
const path  = require('path');
const { spawn } = require('child_process');

const PORT        = Number(process.env.OCCT_POOL_PORT)   || 3001;
const BASE_PORT   = Number(process.env.OCCT_WORKER_PORT) || 3101;
// Ein Arbeiter belegt einen Kern voll. Zwei Kerne bleiben fuer den Python-
// Server, nginx und das System uebrig.
const N_WORKERS   = Number(process.env.OCCT_WORKERS)     || Math.max(1, Math.min(4, os.cpus().length - 2));
const RSS_LIMIT   = Number(process.env.OCCT_RSS_LIMIT_MB) || 2500;   // MB
const MAX_JOBS    = Number(process.env.OCCT_MAX_JOBS)     || 50;     // Auftraege je Arbeiterleben
const JOB_TIMEOUT = Number(process.env.OCCT_JOB_TIMEOUT)  || 600000; // 10 min
const WAIT_LIMIT  = Number(process.env.OCCT_WAIT_LIMIT)   || 240000; // 4 min in der Schlange
const QUEUE_MAX   = Number(process.env.OCCT_QUEUE_MAX)    || 32;

const WORKER_JS = path.join(__dirname, 'occt-server.js');
const CERT = '/home/v3da/v3da.tailf05fe9.ts.net.crt';
const KEY  = '/home/v3da/v3da.tailf05fe9.ts.net.key';

const log = (...a) => console.log('[pool]', ...a);

const workers = [];
const queue = [];          // {req, res, ts, timer}
let   stats = { erledigt: 0, abgewiesen: 0, neugestartet: 0, maxSchlange: 0 };

// ── Arbeiter ──────────────────────────────────────────────────────────

function rssMB(pid) {
  try {
    const m = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+) kB/m);
    return m ? Math.round(Number(m[1]) / 1024) : 0;
  } catch { return 0; }
}

function spawnWorker(w) {
  const proc = spawn(process.execPath, [WORKER_JS], {
    env: { ...process.env, OCCT_WORKER: '1', OCCT_PORT: String(w.port) },
    // stdin bewusst als Pipe: sie ist die Reissleine des Arbeiters. Stirbt der
    // Pool, bricht sie ab und der Arbeiter beendet sich von selbst.
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  proc.stdin.on('error', () => {});   // Pipe bricht beim Beenden — kein Grund zur Aufregung
  w.proc = proc;
  w.state = 'startet';
  w.jobs = 0;
  w.current = null;

  const durchreichen = (strom, wohin) => {
    let rest = '';
    strom.on('data', (d) => {
      rest += d;
      const zeilen = rest.split('\n');
      rest = zeilen.pop();
      for (const z of zeilen) if (z.trim()) wohin(`[w${w.id}] ${z}`);
    });
  };
  durchreichen(proc.stdout, (z) => console.log(z));
  durchreichen(proc.stderr, (z) => console.error(z));

  proc.on('exit', (code, signal) => {
    const lief = w.current;
    w.state = 'tot';
    w.proc = null;
    if (lief) {
      // Der Arbeiter ist mitten im Auftrag gestorben (OOM, WASM-Trap).
      // Der Kunde darf das nicht als Stille erleben.
      antwortFehler(lief.res, 502,
        'Die Berechnung ist im Hintergrund abgebrochen. Bitte noch einmal versuchen — '
        + 'bei sehr feinen Netzen hilft vorher „Vereinfachen".');
      w.current = null;
    }
    if (!w.gewollt) log(`Arbeiter ${w.id} unerwartet beendet (code=${code} signal=${signal}) — Neustart`);
    w.gewollt = false;
    setTimeout(() => spawnWorker(w), 500);
  });

  warteAufBereit(w);
}

function warteAufBereit(w, versuch = 0) {
  if (!w.proc) return;
  const req = http.request(
    { host: '127.0.0.1', port: w.port, path: '/health', method: 'GET', timeout: 3000 },
    (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        let bereit = false;
        try { bereit = !!JSON.parse(d).occtReady; } catch {}
        if (bereit) {
          w.state = 'frei';
          w.seit = Date.now();
          log(`Arbeiter ${w.id} bereit (Port ${w.port}, ${rssMB(w.proc.pid)} MB)`);
          verteilen();
        } else {
          setTimeout(() => warteAufBereit(w, versuch + 1), 500);
        }
      });
    });
  req.on('error', () => setTimeout(() => warteAufBereit(w, versuch + 1), 500));
  req.on('timeout', () => req.destroy());
  req.end();
}

/** Arbeiter zwischen zwei Auftraegen austauschen (Speicherleck, Alter). */
function erneuern(w, grund) {
  if (!w.proc || w.current) return;
  log(`Arbeiter ${w.id} wird erneuert: ${grund}`);
  stats.neugestartet++;
  w.state = 'wird erneuert';
  w.gewollt = true;
  w.proc.kill('SIGTERM');
  const hart = setTimeout(() => { try { w.proc && w.proc.kill('SIGKILL'); } catch {} }, 10000);
  w.proc.once('exit', () => clearTimeout(hart));
}

// ── Warteschlange ─────────────────────────────────────────────────────

function antwortFehler(res, code, text) {
  if (res.headersSent || res.writableEnded) { try { res.end(); } catch {} return; }
  const body = JSON.stringify({ error: text });
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8',
                        'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function verteilen() {
  while (queue.length) {
    const w = workers.find((x) => x.state === 'frei');
    if (!w) return;
    const job = queue.shift();
    clearTimeout(job.timer);
    if (job.res.writableEnded || job.abgebrochen) continue;   // Kunde ist weg
    zuweisen(w, job);
  }
}

function zuweisen(w, job) {
  w.state = 'beschaeftigt';
  w.current = job;
  const wartete = Date.now() - job.ts;
  if (wartete > 1000) log(`Auftrag ${job.req.method} ${job.pfad} nach ${(wartete / 1000).toFixed(1)}s an Arbeiter ${w.id}`);

  const kopf = { ...job.req.headers };
  delete kopf.host;   // sonst zeigt der Arbeiter auf sich selbst zurueck
  const vor = http.request(
    { host: '127.0.0.1', port: w.port, path: job.req.url, method: job.req.method, headers: kopf },
    (antw) => {
      job.res.writeHead(antw.statusCode, {
        ...antw.headers,
        'X-OCCT-Worker': String(w.id),
        'X-OCCT-Wartezeit-ms': String(wartete),
      });
      antw.pipe(job.res);
      antw.on('end', () => fertig(w, true));
    });

  const abbrechen = setTimeout(() => {
    log(`Auftrag auf Arbeiter ${w.id} über ${JOB_TIMEOUT / 1000}s — Arbeiter wird abgeräumt`);
    vor.destroy();
    antwortFehler(job.res, 504, 'Die Berechnung hat zu lange gedauert und wurde abgebrochen.');
    w.current = null;
    w.gewollt = true;
    try { w.proc && w.proc.kill('SIGKILL'); } catch {}
  }, JOB_TIMEOUT);
  job.abbruchTimer = abbrechen;

  vor.on('error', (e) => {
    clearTimeout(abbrechen);
    if (w.current === job) {
      // Stirbt der Arbeiter mitten im Auftrag, kommt hier meist "socket hang up"
      // an — technisch richtig, im Browser aber nutzlos. Der Grund steht im Log.
      log(`Arbeiter ${w.id} brach den Auftrag ab: ${e.message}`);
      antwortFehler(job.res, 502,
        'Die Berechnung ist abgebrochen. Bitte noch einmal versuchen — bei sehr '
        + 'feinen Netzen hilft vorher „Vereinfachen".');
      fertig(w, false);
    }
  });

  // Kunde legt auf: Verbindung zum Arbeiter mit abräumen, sonst rechnet der
  // Prozess minutenlang für niemanden weiter.
  job.res.on('close', () => {
    if (!job.res.writableEnded && w.current === job) {
      clearTimeout(abbrechen);
      vor.destroy();
      log(`Kunde hat aufgelegt — Arbeiter ${w.id} wird abgeräumt`);
      w.current = null;
      w.gewollt = true;
      try { w.proc && w.proc.kill('SIGKILL'); } catch {}
    }
  });

  // Erst jetzt den Rumpf lesen: solange der Auftrag in der Schlange lag, blieb
  // der Datenstrom stehen (TCP-Gegendruck) — 100-MB-STLs liegen so nicht im
  // Speicher des Pools herum.
  job.req.pipe(vor);
}

function fertig(w, gezaehlt) {
  if (w.current) clearTimeout(w.current.abbruchTimer);
  w.current = null;
  if (gezaehlt) { w.jobs++; stats.erledigt++; }
  if (w.state === 'tot' || w.state === 'wird erneuert') return;
  const mb = w.proc ? rssMB(w.proc.pid) : 0;
  if (mb > RSS_LIMIT)        return erneuern(w, `${mb} MB RSS über Grenze ${RSS_LIMIT} MB`);
  if (w.jobs >= MAX_JOBS)    return erneuern(w, `${w.jobs} Aufträge erledigt`);
  w.state = 'frei';
  verteilen();
}

// ── Vordertür ─────────────────────────────────────────────────────────

function zustand() {
  return {
    status: workers.some((w) => w.state === 'frei' || w.state === 'beschaeftigt') ? 'ok' : 'startet',
    occtReady: workers.some((w) => w.state === 'frei' || w.state === 'beschaeftigt'),
    arbeiter: workers.map((w) => ({
      id: w.id, zustand: w.state, auftraege: w.jobs,
      pid: w.proc ? w.proc.pid : null,
      rssMB: w.proc ? rssMB(w.proc.pid) : 0,
    })),
    schlange: queue.length,
    ...stats,
  };
}

const server = https.createServer(
  { cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY) },
  (req, res) => {
    const pfad = req.url.split('?')[0];

    // /health beantwortet der Pool selbst — sonst wuerde eine simple
    // Bereitschaftsabfrage einen Arbeiter belegen und in der Schlange landen.
    if (pfad === '/health' || pfad === '/pool') {
      const body = JSON.stringify(zustand());
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
                           'Content-Length': Buffer.byteLength(body) });
      return res.end(body);
    }

    const frei = workers.find((w) => w.state === 'frei');
    const job = { req, res, ts: Date.now(), pfad, abgebrochen: false };

    if (frei) return zuweisen(frei, job);

    if (queue.length >= QUEUE_MAX) {
      stats.abgewiesen++;
      return antwortFehler(res, 503,
        'Gerade rechnen alle Arbeiter und die Warteschlange ist voll. Bitte in ein paar Minuten noch einmal.');
    }

    job.timer = setTimeout(() => {
      const i = queue.indexOf(job);
      if (i >= 0) queue.splice(i, 1);
      stats.abgewiesen++;
      antwortFehler(res, 503,
        `Alle Arbeiter sind seit ${Math.round(WAIT_LIMIT / 1000)}s belegt. Bitte gleich noch einmal versuchen.`);
    }, WAIT_LIMIT);

    res.on('close', () => { if (!res.writableEnded) job.abgebrochen = true; });

    queue.push(job);
    stats.maxSchlange = Math.max(stats.maxSchlange, queue.length);
    log(`alle ${workers.length} Arbeiter belegt — Auftrag ${pfad} in die Schlange (Platz ${queue.length})`);
  });

server.requestTimeout = 0;   // lange Booleans duerfen nicht abgeschnitten werden
server.headersTimeout = 65000;
server.timeout = 0;

server.listen(PORT, '0.0.0.0', () => {
  log(`OCCT-Pool auf https://0.0.0.0:${PORT} — ${N_WORKERS} Arbeiter, ` +
      `Erneuerung ab ${RSS_LIMIT} MB oder ${MAX_JOBS} Aufträgen`);
  for (let i = 0; i < N_WORKERS; i++) {
    const w = { id: i, port: BASE_PORT + i, state: 'startet', jobs: 0, current: null, gewollt: false };
    workers.push(w);
    spawnWorker(w);
  }
});

function beenden() {
  log('beende Arbeiter…');
  for (const w of workers) { w.gewollt = true; try { w.proc && w.proc.kill('SIGTERM'); } catch {} }
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGTERM', beenden);
process.on('SIGINT', beenden);
