// Test: „⬤ Alles abrunden" ist auch bei Schnitt-/Boolean-/Zerlegen-Ergebnissen
// (Typ custom) erreichbar — im Panel und im Kanten-Modus (Ralf 21.9.2026).
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const r = await pg.evaluate(async () => {
  _newCreate(false);
  const g = new THREE.BoxGeometry(2, 3, 1).toNonIndexed(); g.translate(0, 1.5, 0); g.deleteAttribute('uv');
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
  m.userData = { id: idCtr++, name: 'Teil A', color: '#3377ff', isHole: false, type: 'custom', shapeType: 'custom' };
  scene.add(m); objects.push(m); selectObjs([m]); updateFP();
  await new Promise(r => setTimeout(r, 200));
  const body = () => document.getElementById('fp-body')?.innerHTML || '';
  const out = { panel: body().includes('_openRoundModal()'), edge: body().includes('enterEdgeMode()') };
  enterEdgeMode(); await new Promise(r => setTimeout(r, 400)); _fpCurType = null; updateFP();
  out.edgeMode = typeof _edgeMode !== 'undefined' && _edgeMode;
  out.edgePanel = body();
  return out;
});
ok('Panel zeigt ⬤ Alles abrunden', r.panel);
ok('Panel zeigt weiter ⬡ Kanten bearbeiten', r.edge);
ok('Kanten-Modus aktiv', r.edgeMode);
ok('Kanten-Modus: Hinweis „rundet nicht"', /rundet nicht/.test(r.edgePanel));
ok('Kanten-Modus: Alles-abrunden-Knopf', r.edgePanel.includes('_openRoundModal()'));
await pg.click('#fp-body button[onclick*="_openRoundModal"]');
await pg.waitForTimeout(500);
const modal = await pg.evaluate(() => [...document.querySelectorAll('.modal.show, .modal-bg.show, [id*="round"].show')].map(e => e.id));
ok('Klick öffnet Abrunden-Dialog', modal.length > 0, modal);
ok('keine Seitenfehler', errs.length === 0, errs);
await b.close();
console.log(fails.length ? `\n${fails.length} FEHLER` : '\nalles OK');
process.exit(fails.length ? 1 : 0);
