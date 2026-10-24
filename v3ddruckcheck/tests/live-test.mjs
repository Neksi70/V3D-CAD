// Browser-Test „📡 Drucker live“: Seite (:8810) → Test-Bridge (:17781, eigene Druckerliste) → Moonraker-Attrappe (:17125).
// Prüft Anzeige, Regler (+/−, vorgemerkt, Übernehmen), Hilfe-Vorschlag, Zurück auf Druckbeginn, Profile, Druckcode-Sperre.
// Start: cd ~ && node v3ddruckcheck/tests/live-test.mjs   (Server :8810 muss laufen)
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process';
const { startMock } = await import(os.homedir() + '/orca-wasm/test/moonraker-mock.mjs');
const M = await startMock(17125);
const W = fs.mkdtempSync(path.join(os.tmpdir(), 'v3dlive-'));
fs.writeFileSync(W + '/printers.json', JSON.stringify({ fleetCode: 'test-code-123', printers: [{ id: 'mock', name: 'U1 Attrappe', type: 'moonraker', ip: '127.0.0.1', port: 17125 }] }));
const br = spawn('node', [os.homedir() + '/orca-wasm/bridge/server.js'], { env: { ...process.env, BRIDGE_PORT: '17781', BRIDGE_PRINTERS: W + '/printers.json', NATIVE_SLICER: '/nicht/da' }, stdio: ['ignore', 'pipe', 'pipe'] });
let brLog = ''; br.stdout.on('data', d => brLog += d); br.stderr.on('data', d => brLog += d);
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const B = 'http://127.0.0.1:17781';
const browser = await chromium.launch();
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(B + '/api/printers')).ok) break; } catch {} await new Promise(r => setTimeout(r, 300)); }
  // Druckcode-Sperre: von „außen“ (öffentliche IP im X-Forwarded-For) ohne Code → 403, mit Code → ok
  let r = await fetch(B + '/api/klipper/fleet:mock/live', { headers: { 'X-Forwarded-For': '8.8.8.8' } });
  ok(r.status === 403, 'öffentlich ohne Druckcode gesperrt');
  r = await fetch(B + '/api/klipper/fleet:mock/tune', { method: 'POST', headers: { 'X-Forwarded-For': '8.8.8.8', 'Content-Type': 'application/json' }, body: '{"values":{"speed":150}}' });
  ok(r.status === 403 && !M.scripts.length, 'öffentlich ohne Code: nichts gesendet');
  r = await fetch(B + '/api/klipper/fleet:mock/live', { headers: { 'X-Forwarded-For': '8.8.8.8', 'X-Fleet-Code': 'test-code-123' } });
  ok(r.ok, 'mit Druckcode erlaubt');

  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8810/?bridge=' + encodeURIComponent(B));
  await page.click('#liveBtn');
  await page.waitForFunction(() => document.querySelectorAll('#lvKnobs .knob').length > 5, null, { timeout: 20000 });
  ok(/druckt/.test(await page.textContent('#lvState')) && /halter/.test(await page.textContent('#lvStat')) && /PETG/.test(await page.textContent('#lvStat')), 'Status: druckt halter, PETG');
  // Fluss +1 +1 → vorgemerkt, noch nichts gesendet
  const flow = '#lvKnobs .knob[data-k="flow"]';
  await page.click(`${flow} button[data-d="1"]`); await page.click(`${flow} button[data-d="1"]`);
  ok((await page.textContent(`${flow} .now`)).includes('102') && !M.scripts.length, 'Regler: 102 % vorgemerkt, noch nichts gesendet');
  await page.click('#lvApply');
  await page.waitForFunction(() => /übernommen/.test(document.getElementById('liveMsg').textContent));
  ok(M.scripts.at(-1) === 'M221 S102' && M.st.gcode_move.extrude_factor === 1.02, 'Übernehmen → M221 S102 beim Drucker');
  ok((await page.textContent('#liveLog')).includes('M221 S102'), 'Protokoll zeigt gesendeten Befehl');
  // Vertipper ins Feld: Düse 25 → begrenzt
  await page.fill('#lvKnobs .knob[data-k="nozzle"] input', '25'); await page.press('#lvKnobs .knob[data-k="nozzle"] input', 'Tab');
  await page.click('#lvApply');
  await page.waitForFunction(() => /begrenzt/.test(document.getElementById('liveMsg').textContent));
  ok(M.st.extruder1.target === 200, 'Düse 25 °C im Druck → nur auf 200 °C (' + M.st.extruder1.target + ')');
  // Hilfe: Fäden ziehen
  await page.click('#lvProbs button[data-p="stringing"]');
  await page.waitForSelector('#sugGo');
  ok(/Fäden/.test(await page.textContent('#sug')), 'Vorschlag Fäden angezeigt');
  await page.click('#sugGo');
  await page.waitForFunction(() => /Fäden.*übernommen/.test(document.getElementById('liveMsg').textContent));
  ok(M.st.extruder1.target === 195 && Math.abs(M.st.extruder1.pressure_advance - 0.034) < 1e-9, 'Fäden: 195 °C, PA 0,034');
  // Zurück auf Druckbeginn
  await page.waitForSelector('#lvReset:not([hidden])', { timeout: 10000 });
  await page.click('#lvReset');
  await page.waitForFunction(() => /Druckbeginn/.test(document.getElementById('liveMsg').textContent));
  ok(M.st.gcode_move.extrude_factor === 1 && M.st.extruder1.target === 215, 'Zurück auf Start: Fluss 100 %, Düse Richtung 220 (Sprung-Grenze: ' + M.st.extruder1.target + ')');
  // Profil speichern + anwenden + löschen
  await page.fill('#lvProfName', 'PETG Test');
  await page.click('#lvProfSave');
  await page.waitForFunction(() => /PETG Test/.test(document.getElementById('lvProfs').textContent));
  ok(M.db['v3d/profiles']?.['PETG Test']?.material === 'PETG', 'Profil in der Moonraker-DB (Namespace v3d)');
  page.on('dialog', d => d.accept());
  M.st.print_stats.state = 'standby';
  await page.click('#lvProfs button[data-a="apply"]');
  await page.waitForFunction(() => /angewendet|⚠/.test(document.getElementById('liveMsg').textContent));
  ok(true, 'Profil angewendet');
  await page.click('#lvProfs button[data-a="delete"]');
  await page.waitForFunction(() => /Noch keine Profile/.test(document.getElementById('lvProfs').textContent));
  ok(Object.keys(M.db['v3d/profiles']).length === 0, 'Profil gelöscht');
  ok(!M.scripts.some(s => /G28|G1 |SDCARD|CANCEL/.test(s)), 'nur Regel-Befehle beim Drucker: ' + [...new Set(M.scripts.flatMap(s => s.split('\n')).map(l => l.split(' ')[0]))].join(', '));
  ok(!errors.length, 'keine Seitenfehler ' + errors.join(' | '));
} finally {
  await browser.close(); br.kill(); M.close(); fs.rmSync(W, { recursive: true, force: true });
}
if (fails) console.log(brLog.split('\n').filter(l => /klipper|Error|error/.test(l)).slice(-10).join('\n'));
console.log(fails ? `${fails} FEHLER` : 'alle grün'); process.exit(fails ? 1 : 0);
