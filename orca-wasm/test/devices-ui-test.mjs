// Headless /slicer2: Dialog „Geräte verwalten" — öffnen, Liste, IP erkennen, Drucker anlegen,
// wieder löschen. Die echte printers.json bleibt unberührt: /api/devices* wird per page.route
// auf eine Test-Brücke (:7793) mit Kopie (Symlink wie bei bridge2) + Mini-Moonraker umgeleitet.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, readFileSync, symlinkSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BRIDGE = join(here, '../bridge2');
const dir = mkdtempSync(join(process.env.OUT_DIR || tmpdir(), 'devices-ui-'));
const real = join(dir, 'echt.json'), link = join(dir, 'printers.json');
copyFileSync(join(BRIDGE, 'printers.json'), real);
symlinkSync(real, link);
const before = readFileSync(real, 'utf8');

const mock = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/printer/info')) return res.end('{"result":{"hostname":"lava"}}');
  if (req.url.startsWith('/server/info')) return res.end('{"result":{}}');
  res.statusCode = 404; res.end('{}');
});
await new Promise(r => mock.listen(17126, '127.0.0.1', r));
const tb = spawn('node', [join(BRIDGE, 'server.js')], { cwd: BRIDGE,
  env: { ...process.env, BRIDGE_PORT: '7793', BRIDGE_BIND: '127.0.0.1', BRIDGE_PRINTERS: link } });
let tlog = ''; tb.stdout.on('data', d => { tlog += d; });
for (let i = 0; i < 50 && !/:7793/.test(tlog); i++) await new Promise(r => setTimeout(r, 200));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('dialog', d => d.accept());   // confirm() beim Löschen
await page.route(/\/api\/devices/, async (route) => {
  const u = new URL(route.request().url());
  const r = await fetch('http://127.0.0.1:7793' + u.pathname.replace(/^\/bridge2?/, '') + u.search, {
    method: route.request().method(), headers: { 'Content-Type': 'application/json' },
    body: ['GET', 'HEAD'].includes(route.request().method()) ? undefined : route.request().postData() });
  await route.fulfill({ status: r.status, contentType: 'application/json', body: await r.text(),
    headers: { 'Access-Control-Allow-Origin': '*' } });
});
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) fails++; };

try {
  await page.goto((process.env.APP_URL || 'http://127.0.0.1:8858/slicer2/app/'), { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window._paintDebug === 'function', null, { timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('tabDevice').hidden, null, { timeout: 30000 });
  await page.click('#tabDevice');
  await page.click('#devMgrOpen');
  await page.waitForFunction(() => document.querySelectorAll('#dmList .dmItem').length > 0, null, { timeout: 15000 });
  const n0 = await page.$$eval('#dmList [data-del]', b => b.length);
  check(n0 >= 1, `Dialog offen, ${n0} Geräte gelistet`);

  await page.fill('#dmIp', '127.0.0.1');
  await page.evaluate(() => { document.getElementById('dmPort').value = '17126'; });
  await page.click('#dmProbe');
  await page.waitForFunction(() => !document.getElementById('dmForm').hidden || /err/.test(document.getElementById('dmStatus').innerHTML), null, { timeout: 15000 });
  check(await page.$eval('#dmType', e => e.textContent) === 'Klipper / Moonraker', 'Erkannt: Klipper / Moonraker');
  check(await page.$eval('#dmModel', e => e.value) === 'Snapmaker U1', 'Modell vorbelegt: Snapmaker U1');
  await page.fill('#dmName', 'UI-Test U1');
  await page.click('#dmSave');
  await page.waitForFunction(() => /hinzugefügt|err/.test(document.getElementById('dmStatus').innerHTML), null, { timeout: 30000 });
  check(/hinzugefügt/.test(await page.$eval('#dmStatus', e => e.textContent)), 'Speichern gemeldet');
  check(await page.$$eval('#dmList b', bs => bs.some(b => b.textContent === 'UI-Test U1')), 'neuer Drucker in der Liste');
  check(JSON.parse(readFileSync(real, 'utf8')).printers.some(p => p.name === 'UI-Test U1' && p.port === 17126), 'in der (Test-)printers.json');

  await page.click('#dmList [data-del="fleet:ui-test-u1"]');
  await page.waitForFunction(() => /entfernt|err/.test(document.getElementById('dmStatus').innerHTML), null, { timeout: 15000 });
  check(!(await page.$$eval('#dmList b', bs => bs.some(b => b.textContent === 'UI-Test U1'))), 'nach Löschen nicht mehr gelistet');
  check(readFileSync(real, 'utf8').includes('"printers"') && JSON.stringify(JSON.parse(readFileSync(real, 'utf8')).printers)
        === JSON.stringify(JSON.parse(before).printers), 'Test-Datei wieder im Ausgangszustand');
  await page.click('#dmClose');
  check(await page.$eval('#devMgrDlg', e => e.hidden), 'Dialog geschlossen');
  check(!errors.length, 'keine Seitenfehler ' + errors.join('; '));
} finally {
  await browser.close(); tb.kill(); mock.close();
}
console.log(fails ? `DEVICES-UI-TEST FEHLGESCHLAGEN ❌ (${fails})` : 'DEVICES-UI-TEST OK ✅');
process.exit(fails ? 1 : 0);
