// Ende-zu-Ende-Test Druck-Assistent: Druckcheck-Seite (:8810) ↔ Druck-Helfer v13 im PowerShell-Container
// mit vorgetäuschtem Bambu Studio (VOLME3D_TEST_SLICER, keine Fensterbedienung).
// Prüft: Slicer erkannt → Projekt gelesen → Zweck-Regeln → Übernehmen (3MF zurück + Sicherung) → Profil-Datei → Rückgängig.
// Start: cd ~ && node v3ddruckcheck/tests/assistent-test.mjs   (Server :8810 muss laufen, Docker nötig, Port 7777 frei)
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execSync } from 'node:child_process';

const P = await import(os.homedir() + '/orca-wasm/web/print-check.js');
const SRC = '/tmp/bs/out/stecker.gcode.3mf';   // echtes Bambu-Studio-Projekt (H2C, ASA) aus slice.sh
if (!fs.existsSync(SRC)) { console.log('Testprojekt fehlt: ~/tools/bambustudio/slice.sh erzeugt ' + SRC); process.exit(1); }
const W = fs.mkdtempSync(path.join(os.tmpdir(), 'v3dassist-'));
const helfer = fs.readFileSync(os.homedir() + '/Volme3D-Druck-Helfer.bat', 'utf8');
fs.writeFileSync(W + '/helfer.ps1', helfer.slice(helfer.indexOf('#__PS__') + 7));
for (const d of ['ad/BambuStudio/user/default', 'up', 'proj']) fs.mkdirSync(path.join(W, d), { recursive: true });
fs.copyFileSync(SRC, W + '/proj/Stecker.3mf');
const orig = fs.readFileSync(W + '/proj/Stecker.3mf');
fs.writeFileSync(W + '/ad/BambuStudio/BambuStudio.conf', JSON.stringify({ app: {}, recent_projects: { '001': '/w/proj/Stecker.3mf' } }));
const fake = { key: 'bambu', name: 'Bambu Studio', pid: 4242, title: 'Stecker - Bambu Studio', project: 'Stecker', dirty: false, path: null, dataDir: '/w/ad/BambuStudio', userDirs: ['default'], hwnd: 0 };
const uid = execSync('id -u').toString().trim();
execSync('docker rm -f v3dassist-test >/dev/null 2>&1 || true');
execSync(`docker run -d --name v3dassist-test --user ${uid} --network host -e APPDATA=/w/ad -e USERPROFILE=/w/up -e VOLME3D_AUTO_SEC=99999 ` +
  `-e VOLME3D_TEST_SLICER='${JSON.stringify(fake)}' -v ${W}:/w mcr.microsoft.com/powershell:latest pwsh -NoProfile -Command ". /w/helfer.ps1"`);

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const browser = await chromium.launch();
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch('http://127.0.0.1:7777/ping')).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.URL || 'http://127.0.0.1:8810/');
  await page.evaluate(() => localStorage.removeItem('dc_purpose'));
  await page.waitForFunction(() => /Bambu Studio ist offen/.test(document.getElementById('slName').textContent), null, { timeout: 20000 });
  ok((await page.textContent('#slProj')).includes('Stecker'), 'Slicer + Projekt erkannt');
  await page.selectOption('#slPurpose', 'funktion');
  await page.click('#slGo');
  await page.waitForFunction(() => window._dc && window._dc.findings && window._dc.slicer, null, { timeout: 60000 });
  const z = await page.evaluate(() => window._dc.findings.filter(f => f.cat === 'Zweck').map(f => f.fixes.map(x => x.key + '=' + x.value).join(',')));
  ok(z.length === 1 && z[0].includes('wall_loops=4'), 'Zweck Funktionsteil: ' + z);
  ok(await page.inputValue('#purpose') === 'funktion', 'Zweck auch im Ergebnis gewählt');
  await page.click('#magic');
  await page.waitForSelector('#oSl');
  const pf = await page.evaluate(() => [...document.querySelectorAll('#improve input[data-pf]')].map(el => el.checked));
  ok(pf.length >= 2 && pf.every(Boolean), `Profil-Häkchen an den Zweck-Werten (${pf})`);
  ok(/V3D Funktionsteil/.test(await page.textContent('#pfNames')), 'Profilname angezeigt: ' + (await page.textContent('#pfNames')).slice(0, 90));
  await page.click('#oSl');
  await page.waitForFunction(() => /neu geladen/.test(document.getElementById('slRes').textContent) && /Profil/.test(document.getElementById('slRes').textContent), null, { timeout: 60000 });
  ok(true, 'Übernommen: ' + (await page.textContent('#slRes')).replace(/\s+/g, ' ').slice(0, 160));

  const neu = await P.loadAny('x.3mf', new Uint8Array(fs.readFileSync(W + '/proj/Stecker.3mf')));
  ok(P.cfgStr(neu.cfg, 'wall_loops') === '4' && P.cfgStr(neu.cfg, 'sparse_infill_density') === '25%', 'Projekt im Slicer-Ordner hat die neuen Werte');
  ok(neu.meshes.length === 1 && !neu.gcode, 'Modell drin, alter Slice raus');
  const bak = fs.readdirSync(W + '/up/Volme3D-STL/Projekte/Vorher');
  ok(bak.length === 1 && fs.readFileSync(W + '/up/Volme3D-STL/Projekte/Vorher/' + bak[0]).equals(orig), 'Sicherung = Originaldatei: ' + bak[0]);
  const pdir = W + '/ad/BambuStudio/user/default/process';
  const pfile = fs.existsSync(pdir) ? fs.readdirSync(pdir).filter(f => f.endsWith('.json')) : [];
  const pj = pfile.length ? JSON.parse(fs.readFileSync(pdir + '/' + pfile[0], 'utf8')) : {};
  ok(pfile[0] === '0.20mm Standard @BBL H2C · V3D Funktionsteil.json', 'Profildatei: ' + pfile);
  ok(pj.inherits === '0.20mm Standard @BBL H2C' && pj.from === 'User' && pj.wall_loops === '4' && /^\d+\.\d+\.\d+\.\d+$/.test(pj.version), 'Profil erbt vom Herstellerprofil, nur Abweichungen');

  await page.click('#slUndo');
  await page.waitForFunction(() => /wieder geladen/.test(document.getElementById('slRes').textContent), null, { timeout: 30000 });
  ok(fs.readFileSync(W + '/proj/Stecker.3mf').equals(orig), 'Rückgängig: Original wieder da');
  ok(!errors.length, 'keine Seitenfehler ' + errors.join(' | '));
} finally {
  await browser.close();
  execSync('docker rm -f v3dassist-test >/dev/null 2>&1 || true');
  fs.rmSync(W, { recursive: true, force: true });
}
console.log(fails ? `${fails} FEHLER` : 'alle grün'); process.exit(fails ? 1 : 0);
