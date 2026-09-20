// Smoke-Test: laedt die ausgelieferte (dist) App headless und prueft,
// ob das Minifying die JS-Ausfuehrung oder bekannte Globals zerstoert hat.
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';

// Freien Port vom Betriebssystem holen: 8799 war fest verdrahtet und gehoert
// inzwischen V3D Kristall. Der Testserver startete dann gar nicht, der Test las
// die fremde Seite und meldete "Globals fehlen" statt des Portkonflikts.
const PORT = Number(process.env.SMOKE_PORT) || await new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const srv = spawn('python3', ['volme3d_server.py', String(PORT)], { cwd: process.cwd() });
const srvLog = [];
srv.stdout.on('data', d => srvLog.push(String(d)));
srv.stderr.on('data', d => srvLog.push(String(d)));
await new Promise(r => setTimeout(r, 800));
if (srv.exitCode !== null) {
  console.log('Testserver auf Port ' + PORT + ' beendet mit ' + srv.exitCode + ':\n' + srvLog.join('').slice(-600));
  process.exit(1);
}

// Der Server liefert den Editor nur noch gegen ein gueltiges Sitzungs-Cookie
// aus. Fuers Smoke-Testen stellen wir uns eins selbst aus (gleicher HMAC-
// Schluessel wie der Server) — kein Firebase-Login noetig.
const sessCookie = execFileSync('python3',
  ['-c', "import v3d_auth;print(v3d_auth.make_cookie('smoke','smoke@lokal'))"],
  { cwd: process.cwd(), encoding: 'utf8' }).trim();

const pageErrors = [];
const browser = await chromium.launch();
const context = await browser.newContext();
await context.addCookies([{ name: 'v3dsess', value: sessCookie, domain: 'localhost',
                            path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
const page = await context.newPage();
page.on('pageerror', e => pageErrors.push(String(e)));

let served = '?';
try {
  // App liegt unter /volme3d.html (liefert dist, falls vorhanden). '/' ist seit
  // Einführung der Startseite der Launcher (start.html) und enthält die App-Globals nicht.
  const resp = await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 20000 });
  served = `${resp.status()} ${resp.headers()['content-length'] || '?'}B`;
  // Umleitung auf die Anmeldung waere ein stiller Fehlschlag: die Globals
  // fehlen dann natuerlich, ohne dass am Minifying etwas kaputt ist.
  if (new URL(page.url()).pathname !== '/volme3d.html')
    pageErrors.push('GATE: umgeleitet auf ' + page.url() + ' — Sitzungs-Cookie nicht akzeptiert');
  // Nicht blind warten: das Firebase-SDK kommt vom CDN und war schon mal
  // nach 3,5 s noch nicht da → _authGoogleLogin fehlte, und der Test meldete
  // einen Minify-Schaden, den es nie gab. Also auf die Globals warten.
  try {
    await page.waitForFunction(
      () => typeof window.newScene === 'function' && typeof window._authGoogleLogin === 'function',
      { timeout: 20000 });
  } catch (e) {
    pageErrors.push('WARTEN: Globals kamen nicht innerhalb von 20 s');
  }
  await page.waitForTimeout(500); // Rest der Init nachlaufen lassen
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

console.log('HTTP /volme3d.html:', served);
console.log('Globals:       ', JSON.stringify(globals));
console.log('pageErrors:    ', pageErrors.length);
// Nur echte Skript-Fehler zeigen (Firebase/Netzwerk separat bewerten)
for (const e of pageErrors) console.log('   •', e.slice(0, 160));

const fnOk = Object.values(globals).every(t => t === 'function');
console.log('\n=> Alle Buttons-Globals als function:', fnOk ? 'JA ✓' : 'NEIN ✗');
process.exit(fnOk ? 0 : 1);
