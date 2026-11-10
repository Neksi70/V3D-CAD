// Geräteverwaltung der Bridge (bridge2 /api/devices*) ohne echte Drucker und ohne die echte
// printers.json: eigene Bridge-Instanz (:7792) auf einer Kopie, die — wie bei bridge2 — über einen
// SYMLINK eingebunden ist; Mini-Moonraker auf 127.0.0.1:17125 als „neuer Drucker".
// Prüft: Liste, Erkennen, Anlegen (Erreichbarkeit, Doppelte), Symlink bleibt, Sicherung, Löschen,
// öffentlich ohne Druckcode gesperrt.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, lstatSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BRIDGE = process.env.BRIDGE_DIR || join(here, '../bridge2');
const dir = mkdtempSync(join(process.env.OUT_DIR || tmpdir(), 'devices-'));
const real = join(dir, 'echt.json'), link = join(dir, 'printers.json');
copyFileSync(join(BRIDGE, 'printers.json'), real);
symlinkSync(real, link);
const before = JSON.parse(readFileSync(real, 'utf8'));

const mock = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/printer/info')) return res.end(JSON.stringify({ result: { hostname: 'lava', state: 'ready' } }));
  if (req.url.startsWith('/server/info')) return res.end(JSON.stringify({ result: { klippy_state: 'ready' } }));
  res.statusCode = 404; res.end('{}');
});
await new Promise(r => mock.listen(17125, '127.0.0.1', r));

const proc = spawn('node', [join(BRIDGE, 'server.js')], {
  cwd: BRIDGE, env: { ...process.env, BRIDGE_PORT: '7792', BRIDGE_BIND: '127.0.0.1', BRIDGE_PRINTERS: link },
});
let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
const B = 'http://127.0.0.1:7792';
for (let i = 0; i < 50 && !/Bridge \(HTTP\) :7792/.test(log); i++) await new Promise(r => setTimeout(r, 200));

const call = async (method, p, body, headers = {}) => {
  const r = await fetch(B + p, { method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) fails++; };

try {
  const l0 = await call('GET', '/api/devices');
  check(l0.status === 200 && l0.json.fleet.length === before.printers.length, `Liste: ${l0.json.fleet?.length} Flotten-Drucker`);
  check(!JSON.stringify(l0.json).includes('"code"'), 'Liste enthält keine Zugangscodes');

  const pr = await call('POST', '/api/devices/probe', { ip: '127.0.0.1', port: 17125 });
  check(pr.status === 200 && pr.json.type === 'moonraker' && pr.json.model === 'Snapmaker U1', `Erkennen: ${JSON.stringify(pr.json)}`);
  const pbad = await call('POST', '/api/devices/probe', { ip: '127.0.0.1', port: 17999 });
  check(pbad.status === 404, 'Erkennen ohne Drucker → 404 mit Hinweis');
  check((await call('POST', '/api/devices/probe', { ip: 'kein; rm -rf' })).status === 400, 'ungültige IP → 400');

  const add = await call('POST', '/api/devices', { name: 'Test U1 Neu', type: 'moonraker', ip: '127.0.0.1', port: 17125, model: 'Snapmaker U1' });
  check(add.status === 200 && add.json.id === 'fleet:test-u1-neu', `Anlegen: ${JSON.stringify(add.json)}`);
  const dup = await call('POST', '/api/devices', { name: 'Nochmal', type: 'moonraker', ip: '127.0.0.1', port: 17125 });
  check(dup.status === 409, 'gleiche IP zweimal → 409');
  const off = await call('POST', '/api/devices', { name: 'Aus', type: 'moonraker', ip: '127.0.0.1', port: 17998 });
  check(off.status === 502, 'nicht erreichbar → 502, nichts gespeichert');

  check(lstatSync(link).isSymbolicLink(), 'printers.json ist weiterhin ein Symlink');
  const after = JSON.parse(readFileSync(real, 'utf8'));
  check(after.printers.length === before.printers.length + 1 && after.fleetCode === before.fleetCode,
    'Datei: +1 Drucker, Druckcode und Rest unverändert');
  check(readdirSync(join(dir, 'printers.backup')).length >= 1, 'Sicherung angelegt');
  const l1 = await call('GET', '/api/devices');
  check(l1.json.fleet.some(p => p.id === 'fleet:test-u1-neu' && p.port === 17125), 'neuer Drucker sofort in der Liste');

  const pub = await call('DELETE', '/api/devices/fleet:test-u1-neu', null, { 'X-Forwarded-For': '203.0.113.9' });
  check(pub.status === 403, 'öffentlich ohne Druckcode → 403');
  const del = await call('DELETE', '/api/devices/fleet:test-u1-neu');
  check(del.status === 200, 'Löschen');
  const fin = JSON.parse(readFileSync(real, 'utf8'));
  check(JSON.stringify(fin.printers) === JSON.stringify(before.printers), 'nach Löschen = Ausgangszustand');
  check((await call('DELETE', '/api/devices/fleet:gibtsnicht')).status === 404, 'unbekannte ID → 404');
} finally {
  proc.kill(); mock.close();
}
console.log(fails ? `DEVICES-API-TEST FEHLGESCHLAGEN ❌ (${fails})` : 'DEVICES-API-TEST OK ✅');
process.exit(fails ? 1 : 0);
