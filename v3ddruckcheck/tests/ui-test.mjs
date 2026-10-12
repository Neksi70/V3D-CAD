// Headless-Test V3D Druckcheck: G-Code, Bambu-.gcode.3mf, STL (+ Grundwerte),
// korrigiertes 3MF herunterladen und wieder einlesen.
// Start: cd ~ && node v3ddruckcheck/tests/ui-test.mjs   (Server auf :8810 muss laufen)
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL_ = process.env.URL || 'http://127.0.0.1:8810/';
const T = p => new URL(p, 'file:///home/v3da/orca-wasm/test/').pathname;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 850 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
await page.goto(URL_);
const load = async f => {
  await page.evaluate(() => { window._dc = null; });
  await page.setInputFiles('#file', f);
  await page.waitForFunction(() => window._dc && window._dc.findings, null, { timeout: 60000 });
  return page.evaluate(() => ({ ids: window._dc.findings.map(f => f.id), src: window._dc.r.source, models: window._dc.models.length,
    info: [...['fSub', 'facts']].map(i => document.getElementById(i).innerText).join(' | ') + (document.getElementById('viewMsg').hidden ? '' : ' Kein Modell'), base: !document.getElementById('baseBox').hidden }));
};

console.log('Orca-G-Code');
let r = await load(T('cube20.stl.gcode'));
ok(r.src === 'gcode' && r.models === 0 && !r.base, 'G-Code ohne Modell, Einstellungen aus der Datei');
ok(r.info.includes('Kein Modell'), 'Hinweis „Kein Modell"');

const bambu = '/tmp/bs/out/stecker.gcode.3mf';
if (fs.existsSync(bambu)) {
  console.log('Bambu .gcode.3mf');
  r = await load(bambu);
  ok(r.src === 'gcode3mf' && r.models === 1, 'Modell + Einstellungen gelesen');
  ok(r.info.includes('Bambu Lab H2C') && r.info.includes('16m 29s'), 'Drucker + Druckzeit angezeigt');
}

console.log('STL mit Grundwerten');
r = await load(T('lbracket.stl'));
ok(r.base && r.ids.includes('stuetzen_an'), `Formular sichtbar, Stützen-Befund (${r.ids})`);
await page.selectOption('#bMat', 'ASA'); await page.selectOption('#bBed', 'Cool Plate');
const ids2 = await page.evaluate(() => window._dc.findings.map(f => f.id));
ok(ids2.includes('platte0'), 'Formular ändern prüft neu (ASA auf Cool Plate)');
await page.screenshot({ path: '/tmp/druckcheck-stl.png' });

console.log('Beispiel + Klick → 3D');
await page.goto(URL_);
ok(await page.locator('.tile').count() === 3, 'Startseite mit 3 Kacheln');
await page.screenshot({ path: '/tmp/druckcheck-start.png' });
await page.click('#demo');
await page.waitForFunction(() => window._dc && window._dc.findings, null, { timeout: 30000 });
const demo = await page.evaluate(() => window._dc.findings.map(f => f.id));
ok(demo.includes('stuetzen_an') && demo.includes('nozzle_temperature0') && demo.includes('top'), `Beispiel zeigt typische Fehler (${demo})`);
const si = await page.evaluate(() => window._dc.findings.findIndex(f => f.loc));
await page.click(`.card[data-i="${si}"] .ti`);
await page.waitForTimeout(900);
ok(await page.evaluate(() => !document.getElementById('focusInfo').hidden && document.querySelector('.card.sel') !== null), 'Karte angeklickt → Stelle markiert');
await page.screenshot({ path: '/tmp/druckcheck-demo.png' });

console.log('Korrigiertes 3MF');
{
  // Prüfdatei: Γ-Winkel als Projekt-3MF, PLA mit 300 °C und Stützen aus
  const P = await import('/home/v3da/orca-wasm/web/print-check.js');
  const { build3mf } = await import('/home/v3da/orca-wasm/web/adaptive-layers.js');
  const g = P.parseGcode(fs.readFileSync(T('cube20.stl.gcode'), 'utf8'));
  const cfg = { ...g.cfg, nozzle_temperature: '300,300', enable_support: '0' };
  const mesh = P.parseStl(new Uint8Array(fs.readFileSync(T('lbracket.stl'))));
  const blob = await build3mf([{ pos: mesh.pos, name: 'Winkel' }], { settings: cfg });
  fs.writeFileSync('/tmp/druckcheck-probe.3mf', Buffer.from(await blob.arrayBuffer()));
}
r = await load('/tmp/druckcheck-probe.3mf');
ok(r.src === '3mf' && r.models === 1 && !r.base, 'Projekt-3MF: Modell + Einstellungen');
ok(r.ids.includes('stuetzen_an') && r.ids.includes('nozzle_temperature0'), `Stützen + Temperatur erkannt (${r.ids})`);
ok(await page.locator('#magic').isVisible(), '„✨ Alles verbessern" sichtbar');
await page.click('#magic');
const imp = await page.evaluate(() => window._dc.lastImprove);
ok(imp && imp.after > imp.before && imp.can3mf, `Vorher/Nachher ${imp && imp.before} → ${imp && imp.after}`);
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/druckcheck-3mf.png' });
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#o3mf')]);
const out = '/tmp/druckcheck-probe_korrigiert.3mf';
await dl.saveAs(out);
{
  const P = await import('/home/v3da/orca-wasm/web/print-check.js');
  const back = await P.loadAny('x.3mf', new Uint8Array(fs.readFileSync(out)));
  ok(P.cfgStr(back.cfg, 'enable_support') === '1' && P.cfgStr(back.cfg, 'support_type') === 'tree(auto)', 'heruntergeladenes 3MF: Stützen an (Baum)');
  ok(P.cfgNum(back.cfg, 'nozzle_temperature', 0) < 240, `heruntergeladenes 3MF: Temperatur korrigiert (${P.cfgStr(back.cfg, 'nozzle_temperature')})`);
  ok(back.meshes.length === 1, 'Modell noch drin');
  const again = P.checkSettings(back.cfg, { models: back.meshes.map(m => P.analyzeMesh(m.pos, m.index)) });
  ok(!again.some(f => f.level >= P.LEVEL.WARN), `neu geprüft: keine Warnung mehr (${again.map(f => f.id)})`);
}

ok(!errors.length, 'keine Seitenfehler ' + errors.join(' | '));
await browser.close();
console.log(fails ? `\n${fails} FEHLGESCHLAGEN` : '\nalle grün');
process.exit(fails ? 1 : 0);
