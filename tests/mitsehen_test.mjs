// Headless-Test fuer "Gemeinsam arbeiten" (Sitzung mit Staffelstab).
// Prueft alles, was ohne Firestore-Login geht: Modul geladen, Fenster,
// Fingerabdruck, Snapshot-Runde (senden→empfangen), Markierungen, UI-Sperre
// und den Einstieg ueber ?sitzung=.
//
// 8797, nicht 8799 — den Port belegt smoke.mjs.
// Gegen die ausgelieferte dist:  python3 volme3d_server.py 8797
// Gegen die Arbeitskopie:        python3 volme3d_server.py 8797 --dev
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8797';
let fails = 0;
const ok = (n, c, extra) => { if (c) console.log('  ✓ ' + n); else { fails++; console.log('  ✗ ' + n + (extra ? '  → ' + extra : '')); } };

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
const api = await page.evaluate(() => ['_mitStart','_mitJoin','_mitStop','_mitLeave','_mitOpen','_mitClose','_mitFp','_mitPushDoc',
  '_mitApplyDoc','_mitShowMark','_mitClearMarks','_mitGivePen','_mitTakePen','_mitAskPen','_mitHasPen','_mitBar','_mitLockUI','_mitCodeAsk']
  .filter(f => typeof window[f] !== 'function'));
ok('alle Funktionen global', api.length === 0, 'fehlt: ' + api.join(','));
ok('Menueintrag da', await page.locator('.sli-item', { hasText: 'Gemeinsam arbeiten' }).count() === 1);

console.log('\n3) Fenster oeffnet (ohne Sitzung)');
await page.evaluate(() => _mitOpen());
await page.waitForTimeout(200);
ok('Modal sichtbar', await page.locator('#mit-modal.show').count() === 1);
ok('Startknopf da', (await page.locator('#mit-body').innerText()).includes('Sitzung starten'));
await page.evaluate(() => _mitClose());

console.log('\n4) Fingerabdruck reagiert auf Aenderungen');
const fp = await page.evaluate(async () => {
  addShape('box');
  await new Promise(r => setTimeout(r, 400));
  const a = _mitFp();
  const o = objects[objects.length - 1];
  o.position.x += 1.234; o.updateMatrixWorld(true);
  const b = _mitFp();
  o.position.x -= 1.234; o.updateMatrixWorld(true);
  return { a, b, c: _mitFp(), n: objects.length };
});
ok('Objekt angelegt', fp.n > 0);
ok('Verschieben aendert den Abdruck', fp.a !== fp.b);
ok('Zuruecksetzen ergibt denselben Abdruck', fp.a === fp.c);

console.log('\n5) Snapshot-Runde — genau das geht ueber die Leitung');
const round = await page.evaluate(async () => {
  addShape('cylinder');
  await new Promise(r => setTimeout(r, 500));
  objects[objects.length-1].userData.name = 'Prüfzylinder';
  const snap = _sceneSnapshot();
  const packed = _dsCompress(JSON.stringify(snap));
  const before = { n: objects.length, names: objects.map(o => o.userData.name) };
  // so wie der Empfaenger es auspackt
  const back = JSON.parse(_dsDecompress(packed));
  _applySnapshot(back);
  await new Promise(r => setTimeout(r, 400));
  return { before, packedKB: Math.round(packed.length/102.4)/10,
           after: { n: objects.length, names: objects.map(o => o.userData.name) },
           hasParams: !!(back.objects||[]).find(o => o.shapeType || o.type) };
});
ok('Objektzahl bleibt gleich', round.before.n === round.after.n, JSON.stringify(round));
ok('Namen kommen mit', JSON.stringify(round.before.names) === JSON.stringify(round.after.names), JSON.stringify(round.after.names));
ok('Parameter statt nur Dreiecke', round.hasParams);
ok('Nutzlast bleibt klein (' + round.packedKB + ' KB)', round.packedKB < 900);

console.log('\n6) Markierungen');
const mk = await page.evaluate(() => {
  _mitShowMark('m1', { p: [0, 1, 0], t: 'Hier klemmt es', by: 'Tester' });
  _mitShowMark('m1', { p: [0, 1, 0], t: 'Doppelt', by: 'Tester' });
  _mitShowMark('m2', { p: [1, 1, 1], t: '', by: 'Tester' });
  const g = scene.children.find(c => c.userData && c.userData.isHelper);
  const r = { marks: g ? g.children.length : 0, inObjects: objects.some(o => o === g) };
  _mitRemoveMark('m1');
  r.afterRemove = g ? g.children.length : -1;
  return r;
});
ok('zwei Markierungen, keine Dublette', mk.marks === 2, 'gezaehlt: ' + mk.marks);
ok('Markierungen sind kein Bauteil', mk.inObjects === false);
ok('Entfernen wirkt', mk.afterRemove === 1);

const clean = await page.evaluate(() => ({ n: _sceneSnapshot().objects.length }));
ok('Markierungen landen nicht im Snapshot', clean.n === round.after.n, `${clean.n} statt ${round.after.n}`);

console.log('\n7) Staffelstab und UI-Sperre');
const pen = await page.evaluate(async () => {
  // Sitzung vortaeuschen, ohne Firestore: nur die Anzeige-/Sperrlogik pruefen
  // _mit ist ein Top-Level-let — window._mit waere eine ANDERE Variable
  _mit = { id:'s_x', code:'123456', ref:null, role:'guest', me:'g_1', myName:'Gast',
                  hostName:'Volker', pen:'host', penReq:'', exp:Date.now()+3.6e6, follow:false, peerHere:true };
  _mitBar();
  const asGuest = { hasPen: _mitHasPen(), ro: document.body.classList.contains('mit-ro'),
                    bar: document.getElementById('mit-bar')?.innerText || '' };
  _mit.pen = 'g_1'; _mitBar();
  const withPen = { hasPen: _mitHasPen(), ro: document.body.classList.contains('mit-ro'),
                    bar: document.getElementById('mit-bar')?.innerText || '' };
  const rpBlocked = getComputedStyle(document.getElementById('rp')).pointerEvents;
  _mit.pen = 'host'; _mitBar();
  const rpBlockedNow = getComputedStyle(document.getElementById('rp')).pointerEvents;
  _mit = null; _mitBar();
  return { asGuest, withPen, rpFree: rpBlocked, rpBlockedNow,
           barGone: !document.getElementById('mit-bar'), roGone: !document.body.classList.contains('mit-ro') };
});
ok('ohne Stift: Werkzeuge gesperrt', pen.asGuest.ro === true);
ok('ohne Stift: Leiste nennt den anderen', /Volker/.test(pen.asGuest.bar), pen.asGuest.bar.replace(/\n/g,' '));
ok('ohne Stift: Anfordern angeboten', /anfordern/i.test(pen.asGuest.bar));
ok('mit Stift: entsperrt', pen.withPen.hasPen === true && pen.withPen.ro === false);
ok('mit Stift: Abgeben angeboten', /abgeben/i.test(pen.withPen.bar), pen.withPen.bar.replace(/\n/g,' '));
ok('rechtes Panel wirklich blockiert', pen.rpFree === 'auto' && pen.rpBlockedNow === 'none', `${pen.rpFree} / ${pen.rpBlockedNow}`);
ok('nach Sitzungsende alles zurueck', pen.barGone && pen.roGone);

console.log('\n8) Einstieg ueber ?sitzung=');
const p2 = await browser.newPage();
const e2 = [];
p2.on('pageerror', e => e2.push(String(e)));
await p2.goto(BASE + '/volme3d.html?sitzung=s_gibtesnicht', { waitUntil: 'load' });
await p2.waitForTimeout(4000);
ok('laedt ohne Fehler', e2.length === 0, e2.slice(0,2).join(' | '));
ok('Code-Abfrage erscheint', await p2.locator('#mit-code-in').count() === 1);
// Der Gast hat kein Konto — Anmeldefenster und Startbildschirm duerfen ihn
// nicht blockieren, beide liegen sonst ueber der Code-Abfrage.
ok('Anmeldefenster bleibt zu', await p2.locator('#auth-overlay.hidden').count() === 1);
ok('Startbildschirm blockiert nicht', await p2.locator('#start-modal.show').count() === 0);
await p2.fill('#mit-code-in', '000000');
await p2.click('#mit-modal .btn.pri');
await p2.waitForTimeout(4000);
const err = await p2.locator('#mit-code-err').innerText();
ok('unbekannte Sitzung wird abgefangen', /fehlgeschlagen|falsch|beendet/i.test(err), err);

await browser.close();
console.log(fails ? `\n${fails} Prüfung(en) fehlgeschlagen\n` : '\nAlle Prüfungen bestanden\n');
process.exit(fails ? 1 : 0);
