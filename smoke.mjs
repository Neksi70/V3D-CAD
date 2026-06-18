// Smoke-Test: laedt die ausgelieferte (dist) App headless und prueft,
// ob das Minifying die JS-Ausfuehrung oder bekannte Globals zerstoert hat.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8799;
const srv = spawn('python3', ['volme3d_server.py', String(PORT)], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 800));

const pageErrors = [];
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => pageErrors.push(String(e)));

let served = '?';
try {
  const resp = await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 20000 });
  served = `${resp.status()} ${resp.headers()['content-length'] || '?'}B`;
  await page.waitForTimeout(3500); // Init/Module laufen lassen
} catch (e) {
  pageErrors.push('GOTO: ' + e.message);
}

const globals = await page.evaluate(() => {
  const names = ['newScene', '_localSave', '_openChangelog', '_toggleDevMode', '_authGoogleLogin'];
  const out = {};
  for (const n of names) out[n] = typeof window[n];
  return out;
});

await browser.close();
srv.kill();

console.log('HTTP /:        ', served);
console.log('Globals:       ', JSON.stringify(globals));
console.log('pageErrors:    ', pageErrors.length);
// Nur echte Skript-Fehler zeigen (Firebase/Netzwerk separat bewerten)
for (const e of pageErrors) console.log('   •', e.slice(0, 160));

const fnOk = Object.values(globals).every(t => t === 'function');
console.log('\n=> Alle Buttons-Globals als function:', fnOk ? 'JA ✓' : 'NEIN ✗');
process.exit(fnOk ? 0 : 1);
