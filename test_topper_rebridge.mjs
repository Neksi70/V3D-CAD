// Test für „Stege neu berechnen" (_ttRebridge): Topper zerlegt erstellen, einen
// Buchstaben wegziehen, Stege neu setzen — danach muss wieder ALLES an einem
// Stück hängen. Prüft außerdem Umriss-Erkennung, Lage/Dicke der neuen Stege,
// Ersetzen alter Stege und den Fall „Gruppe ausgewählt".
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8800;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));

await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);

const res = await page.evaluate(async () => {
  const out = {};
  if (typeof _ttRebridge !== 'function') return { err: '_ttRebridge fehlt' };

  // Zusammenhang der Teile in ihrer JETZIGEN Weltlage prüfen: Umrisse holen,
  // berührende/überlappende und per Steg verbundene Teile zusammenfassen.
  const components = (meshes) => {
    meshes.forEach(m => m.updateMatrixWorld(true));
    const N = _ttPlateNormal(meshes);
    const U = new THREE.Vector3(Math.abs(N.x) > 0.9 ? 0 : 1, Math.abs(N.x) > 0.9 ? 1 : 0, 0);
    U.crossVectors(U, N).normalize();
    const V = new THREE.Vector3().crossVectors(N, U).normalize();
    const P = meshes.map(m => _ttOutlines2D(m, N, U, V)).flat();
    const n = P.length, root = [...Array(n).keys()];
    const find = i => { while (root[i] !== i) { root[i] = root[root[i]]; i = root[i]; } return i; };
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (_ttClosest(P[i], P[j]).d < 0.035
        || P[i].some(p => _ttInPoly(P[j], p.x, p.y)) || P[j].some(p => _ttInPoly(P[i], p.x, p.y)))
        root[find(i)] = find(j);
    }
    const s = new Set(); for (let i = 0; i < n; i++) s.add(find(i));
    return { comps: s.size, outlines: n, total: meshes.length };
  };
  const leaves = g => { const a = []; g.traverse(c => { if (c.isMesh && c.geometry && !c.userData.isEdgeLines) a.push(c); }); return a; };

  // ── Topper zerlegt erstellen ──
  document.getElementById('tt-text').value = 'Lili';
  document.getElementById('tt-font').value = 'helvetiker_bold';
  document.getElementById('tt-pins').value = '1';
  document.getElementById('tt-dheart').checked = false;
  document.getElementById('tt-explode').checked = true;
  document.getElementById('tt-web').value = 2;
  _ttMotifClear();
  await new Promise(r => _npLoadFont('helvetiker_bold', r));
  const n0 = objects.length;
  _ttCreate();
  await new Promise(r => setTimeout(r, 700));
  const grp = objects[objects.length - 1];
  out.created = objects.length - n0;
  out.kids0 = grp.children.map(c => c.userData.name);

  // Frisch erstellt hängt alles zusammen
  out.before = components(leaves(grp));

  // ── Aufheben, dann einen Buchstaben wegziehen ──
  selectObjs([grp]);
  ungroupSelected();
  await new Promise(r => setTimeout(r, 200));
  const all = objects.filter(o => /^(L|i|l|i \(2\)|Steg|Pin)/.test(o.userData.name || ''));
  out.freed = all.length;
  const L = all.find(o => o.userData.name === 'L');
  L.position.x -= 3.5;                     // 35 mm nach links — reißt komplett ab
  L.updateMatrixWorld(true);
  out.afterMove = components(all);

  // ── Stege neu berechnen ──
  selectObjs(all);
  _ttRebridge();
  await new Promise(r => setTimeout(r, 300));
  const after = objects.filter(o => /^(L|i|l|i \(2\)|Steg|Pin)/.test(o.userData.name || ''));
  out.afterCount = after.length;
  out.oldGone = after.filter(o => /^Steg/.test(o.userData.name)).length;
  out.afterFix = components(after);

  // Neue Stege liegen in derselben Ebene und haben dieselbe Dicke wie die Teile
  const bb = o => { const b = new THREE.Box3().setFromObject(o); return b; };
  const bLet = bb(after.find(o => o.userData.name === 'l'));
  const bSteg = bb(after.find(o => /^Steg/.test(o.userData.name)));
  out.thickEqual = Math.abs((bSteg.max.y - bSteg.min.y) - (bLet.max.y - bLet.min.y)) < 0.01;
  out.baseEqual = Math.abs(bSteg.min.y - bLet.min.y) < 0.01;
  // Steg-Breite 2 mm = 0,2 Einheiten → schmalste waagerechte Ausdehnung passt
  out.webMM = +(Math.min(bSteg.max.x - bSteg.min.x, bSteg.max.z - bSteg.min.z) * 10).toFixed(2);

  // ── Nochmal aufrufen: idempotent, alte Stege werden ersetzt ──
  selectObjs(after);
  _ttRebridge();
  await new Promise(r => setTimeout(r, 300));
  const twice = objects.filter(o => /^(L|i|l|i \(2\)|Steg|Pin)/.test(o.userData.name || ''));
  out.twiceCount = twice.length;
  out.twiceFix = components(twice);

  // ── Fall „Gruppe ausgewählt": neue Stege landen IN der Gruppe ──
  selectObjs(twice);
  groupSelected();
  await new Promise(r => setTimeout(r, 200));
  const g2 = objects[objects.length - 1];
  const kidsBefore = g2.children.length;
  selectObjs([g2]);
  _ttRebridge();
  await new Promise(r => setTimeout(r, 300));
  out.groupStillOne = objects[objects.length - 1] === g2;
  out.groupKidsDelta = g2.children.length - kidsBefore;
  out.groupFix = components(leaves(g2));

  // ── Zu wenig ausgewählt → freundliche Absage statt Absturz ──
  selectObjs([g2.children[0]]);
  _ttRebridge();
  out.singleSafe = true;
  return out;
});

console.log(JSON.stringify(res, null, 2));
console.log('\nSeitenfehler:', errs.length ? errs : 'keine');

const ok =
  res.created === 1 &&
  res.before.comps === 1 && res.before.outlines >= res.before.total &&
  res.afterMove.comps > 1 &&                       // verschoben = wirklich abgerissen
  res.afterFix.comps === 1 &&                      // neu gestegt = wieder ein Stück
  res.afterFix.outlines > res.afterFix.total &&
  res.oldGone > 0 &&
  res.thickEqual && res.baseEqual && Math.abs(res.webMM - 2) < 0.15 &&
  res.twiceFix.comps === 1 && res.twiceCount === res.afterCount &&
  res.groupStillOne && res.groupFix.comps === 1 &&
  res.singleSafe;

console.log(ok ? '\n✅ Stege neu berechnen: alle Prüfungen bestanden' : '\n❌ Stege neu berechnen: Prüfung fehlgeschlagen');

await browser.close();
srv.kill();
process.exit(ok && !errs.length ? 0 : 1);
