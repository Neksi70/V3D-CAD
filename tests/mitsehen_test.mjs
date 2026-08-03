// Headless-Test fuer "Mitsehen lassen" (Live-Sitzung).
// Prueft alles, was ohne Firestore-Login geht: Modul geladen, Fenster, Fingerabdruck,
// Objektbaum-Kurzfassung, Markierungs-Darstellung (Stufe 3) und den Zuschauer-Viewer.
import { chromium } from 'playwright';

// 8797, nicht 8799 — den Port belegt smoke.mjs.
// Gegen die ausgelieferte dist:  python3 volme3d_server.py 8797
// Gegen die Arbeitskopie:        python3 volme3d_server.py 8797 --dev
const BASE = process.env.BASE || 'http://127.0.0.1:8797';
let fails = 0;
const ok  = (n, c, extra) => { if (c) console.log('  ✓ ' + n); else { fails++; console.log('  ✗ ' + n + (extra ? '  → ' + extra : '')); } };

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

console.log('\n1) Editor laedt');
await page.goto(BASE + '/volme3d.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window._mitFp === 'function' && typeof window.addShape === 'function', { timeout: 40000 });
await page.waitForTimeout(1500);
ok('keine Ladefehler', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log('\n2) Modul vorhanden');
const api = await page.evaluate(() => ['_mitStart','_mitStop','_mitOpen','_mitClose','_mitFp','_mitTree','_mitShowMark','_mitClearMarks','_mitPushGeo','_mitPushCam']
  .filter(f => typeof window[f] !== 'function'));
ok('alle Funktionen global', api.length === 0, 'fehlt: ' + api.join(','));
ok('Menueintrag da', await page.locator('.sli-item', { hasText: 'Mitsehen lassen' }).count() === 1);

console.log('\n3) Fenster oeffnet (ohne Sitzung)');
await page.evaluate(() => _mitOpen());
await page.waitForTimeout(200);
ok('Modal sichtbar', await page.locator('#mit-modal.show').count() === 1);
ok('Startknopf da', (await page.locator('#mit-body').innerText()).includes('Mitsehen starten'));
await page.evaluate(() => _mitClose());
ok('Modal schliesst', await page.locator('#mit-modal.show').count() === 0);

console.log('\n4) Fingerabdruck reagiert auf Aenderungen');
const fp = await page.evaluate(async () => {
  addShape('box');
  await new Promise(r => setTimeout(r, 400));
  const a = _mitFp();
  const o = objects[objects.length - 1];
  o.position.x += 1.234; o.updateMatrixWorld(true);
  const b = _mitFp();
  o.position.x -= 1.234; o.updateMatrixWorld(true);
  const c = _mitFp();
  return { a, b, c, n: objects.length };
});
ok('Objekt angelegt', fp.n > 0);
ok('Verschieben aendert den Abdruck', fp.a !== fp.b, `a=${fp.a} b=${fp.b}`);
ok('Zuruecksetzen ergibt denselben Abdruck', fp.a === fp.c);

console.log('\n5) Objektbaum-Kurzfassung');
const tree = await page.evaluate(() => _mitTree());
ok('Eintrag je Objekt', Array.isArray(tree) && tree.length === fp.n, JSON.stringify(tree).slice(0, 160));
ok('hat Name und Masse', !!tree[0] && typeof tree[0].n === 'string' && Array.isArray(tree[0].d), JSON.stringify(tree[0]));

console.log('\n6) Bake liefert Geometrie fuer den Zuschauer');
const bake = await page.evaluate(() => { const p = _shareBakeParts(); return { n: p.length, v: p.reduce((s,x)=>s+x.n,0), hasB64: !!(p[0] && p[0].p) }; });
ok('Teile gebacken', bake.n > 0 && bake.v > 0, JSON.stringify(bake));
ok('als Base64 verpackt', bake.hasB64);

console.log('\n7) Markierung erscheint in der Szene (Stufe 3)');
const mk = await page.evaluate(() => {
  const before = scene.children.length;
  _mitShowMark('m1', { p: [0, 1, 0], t: 'Hier klemmt es', by: 'Tester' });
  _mitShowMark('m1', { p: [0, 1, 0], t: 'Doppelt', by: 'Tester' });   // darf nicht doppelt anlegen
  _mitShowMark('m2', { p: [1, 1, 1], t: '', by: 'Tester' });
  const g = scene.children.find(c => c.userData && c.userData.isHelper);
  const inObjects = objects.some(o => o === g);
  const r = { marks: g ? g.children.length : 0, inObjects, grew: scene.children.length > before };
  _mitRemoveMark('m1');
  r.afterRemove = g ? g.children.length : -1;
  return r;
});
ok('zwei Markierungen, keine Dublette', mk.marks === 2, 'gezaehlt: ' + mk.marks);
ok('Markierungen sind kein Bauteil', mk.inObjects === false);
ok('Entfernen wirkt', mk.afterRemove === 1, 'danach: ' + mk.afterRemove);

console.log('\n8) Markierungen landen nicht im Export');
const clean = await page.evaluate(() => {
  const p = _shareBakeParts();
  return { parts: p.length, tree: _mitTree().length };
});
ok('Bake ignoriert Markierungen', clean.parts === bake.n, `vorher ${bake.n}, jetzt ${clean.parts}`);
ok('Baum ignoriert Markierungen', clean.tree === fp.n);

console.log('\n9) Zuschauer-Viewer');
const v = await browser.newPage();
const vErr = [];
v.on('pageerror', e => vErr.push(String(e)));
await v.goto(BASE + '/mitsehen.html', { waitUntil: 'load' });
await v.waitForTimeout(2500);
ok('laedt ohne Fehler', vErr.length === 0, vErr.slice(0, 2).join(' | '));
ok('meldet fehlende Kennung', (await v.locator('#msg').innerText()).includes('Kein Link'));

await v.goto(BASE + '/mitsehen.html?s=s_gibtesnicht', { waitUntil: 'load' });
await v.waitForTimeout(3500);
const txt = await v.locator('#msg').innerText();
ok('unbekannte Sitzung wird abgefangen', /nicht gefunden|nicht erreichbar/i.test(txt), txt.replace(/\n/g, ' ').slice(0, 90));

await browser.close();
console.log(fails ? `\n${fails} Prüfung(en) fehlgeschlagen\n` : '\nAlle Prüfungen bestanden\n');
process.exit(fails ? 1 : 0);
