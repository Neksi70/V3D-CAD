// Nativer Slice-Dienst: hält EINEN orca_native-Prozess (stdin/stdout-JSON,
// siehe OrcaSlicer/src/wasm/slicer_native.cpp) und serialisiert Jobs darüber.
// Der Prozess bleibt am Leben → inkrementelles Re-Slicen wirkt über
// Browser-Reloads hinweg. Jobs laufen nacheinander (ein Slice nutzt eh alle
// Kerne); die HTTP-Seite pollt den Status (proxy-freundlich wie die Kamera).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const BIN = process.env.NATIVE_SLICER ||
  path.join(__dirname, '..', 'OrcaSlicer', 'build-native', 'src', 'wasm', 'orca_native');
const RESOURCES = path.join(__dirname, '..', 'OrcaSlicer', 'resources');
const TMP = path.join(os.tmpdir(), 'volmeslice-native');

function available() { try { fs.accessSync(BIN, fs.constants.X_OK); return true; } catch { return false; } }

let proc = null;
let current = null;            // { id, job:HTTP-Job }
const queue = [];
const jobs = new Map();        // id -> { state, percent, text, gcodePath, error, created }

function ensureProc() {
  if (proc && proc.exitCode === null) return proc;
  fs.mkdirSync(TMP, { recursive: true });
  proc = spawn(BIN, [], { env: { ...process.env, SLIC3R_RESOURCES: RESOURCES } });
  console.log('[native] Slicer-Prozess gestartet, PID', proc.pid);
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      const j = jobs.get(m.id);
      if (!j) continue;
      if (m.progress != null) { j.percent = m.progress; j.text = m.text || ''; }
      if (m.error) { j.state = 'error'; j.error = m.error; finish(); }
      if (m.done) { j.state = 'done'; j.gcodePath = m.gcode; j.warnings = m.warnings; finish(); }
    }
  });
  proc.stderr.on('data', (d) => process.stderr.write('[native] ' + d));
  proc.on('exit', (code) => {
    console.log('[native] Prozess beendet', code);
    if (current) {
      const j = jobs.get(current.id);
      if (j && j.state === 'running') { j.state = 'error'; j.error = 'Slicer-Prozess abgestürzt'; }
      current = null;
    }
    proc = null;
    if (queue.length) pump();   // Neustart für wartende Jobs
  });
  return proc;
}

function finish() {
  if (current) { try { fs.unlinkSync(current.modelPath); } catch {} }
  current = null;
  pump();
}

function pump() {
  if (current || !queue.length) return;
  current = queue.shift();
  const j = jobs.get(current.id);
  j.state = 'running';
  ensureProc().stdin.write(JSON.stringify(current.payload) + '\n');
}

// Job einreihen: bytes = Buffer der Modelldatei; paints (Mal-Werkzeug):
// je (Objekt,Instanz) null oder { verts, tris, states } als base64
function submit({ filename, bytes, profiles, overrides, transforms, filamentChains, paints, ops }) {
  const id = crypto.randomBytes(8).toString('hex');
  const modelPath = path.join(TMP, id + '_' + String(filename || 'model').replace(/[^\w.\-]/g, '_'));
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(modelPath, bytes);
  jobs.set(id, { state: 'queued', percent: 0, text: '', created: Date.now() });
  queue.push({ id, modelPath, payload: {
    id, model: modelPath, filename,
    profiles: profiles || [], overrides: overrides || '',
    transforms: transforms || null, filament_chains: filamentChains || [],
    paints: paints || null,
    cuts: (ops && ops.cuts) || [], adaptive: (ops && ops.adaptive) || null,
  } });
  pump();
  return id;
}

function status(id) { return jobs.get(id) || null; }

// Fertige G-Code-Datei ausliefern und aufräumen
function takeGcode(id) {
  const j = jobs.get(id);
  if (!j || j.state !== 'done') return null;
  return j.gcodePath;
}

// Alte Jobs/G-Codes wegräumen (30 min)
setInterval(() => {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (now - j.created < 30 * 60 * 1000) continue;
    if (j.gcodePath) { try { fs.unlinkSync(j.gcodePath); } catch {} }
    jobs.delete(id);
  }
}, 5 * 60 * 1000).unref?.();

module.exports = { available, submit, status, takeGcode };
