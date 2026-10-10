// Textur auf gewählte Flächen: Zylinder nur Mantel, Box nur Oberseite, Abwählen, Speichern/Laden, wasserdicht
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8974;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _texToggleFaceAt === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {}
    window._T = {
      // Abweichung je Bereich: wie weit liegen Punkte von der Ausgangsform weg?
      stats: (o, kind) => {
        o.updateMatrixWorld(true); const P = o.geometry.attributes.position, v = new THREE.Vector3();
        const bb = getMeshBox(o), c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3());
        const R = { top: 0, bottom: 0, side: 0, nTop: 0 };
        for (let i = 0; i < P.count; i++) {
          v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld);
          if (kind === 'cyl') {
            const r = Math.hypot(v.x - c.x, v.z - c.z), R0 = 1.0;   // Zylinder r = 10 mm
            if (r < R0 * 0.85 && v.y > 1.0) { R.top = Math.max(R.top, Math.abs(v.y - 2.0)); R.nTop++; }   // Deckel muss auf y=20mm liegen
            else if (v.y > 0.2 && v.y < 1.8) R.side = Math.max(R.side, Math.abs(r - R0));
          } else {
            const onTopZone = Math.abs(v.x - c.x) < s.x * 0.4 && Math.abs(v.z - c.z) < s.z * 0.4 && v.y > c.y;
            if (onTopZone) R.top = Math.max(R.top, Math.abs(v.y - 2.0));
            const onSide = Math.abs(v.y - c.y) < s.y * 0.3 && Math.abs(v.z - c.z) < s.z * 0.3 && v.x > c.x;
            if (onSide) R.side = Math.max(R.side, Math.abs(v.x - 1.5));
          }
        }
        return R;
      },
      watertight: o => {
        const g = o.geometry.clone(); for (const n in g.attributes) if (n !== 'position') g.deleteAttribute(n);
        const m = THREE.BufferGeometryUtils.mergeVertices(g, 1e-5), I = m.index.array, E = new Map();
        for (let i = 0; i < I.length; i += 3) { const a = I[i], b2 = I[i+1], c = I[i+2]; if (a === b2 || b2 === c || a === c) continue;
          for (const [x, y] of [[a,b2],[b2,c],[c,a]]) { const k = x < y ? x+'_'+y : y+'_'+x; E.set(k, (E.get(k)||0)+1); } }
        let bad = 0; for (const n of E.values()) if (n !== 2) bad++; return bad;
      },
      hit: (o, from, dir) => { o.updateMatrixWorld(true); const rc = new THREE.Raycaster(); rc.set(from, dir.normalize()); return rc.intersectObject(o, false)[0]; },
    };
  });
  // ── Zylinder Ø20×20, Muster Waben 1 mm, nur Mantel ──
  const r1 = await p.evaluate(async () => {
    _newCreate(false); addShape('cylinder'); const o = objects[0];
    const s = getMeshBox(o).getSize(new THREE.Vector3()); o.scale.multiply(new THREE.Vector3(2 / s.x, 2 / s.y, 2 / s.z)); o.position.set(0, 0, 0); o.updateMatrixWorld(true);
    o.position.y -= getMeshBox(o).min.y; o.updateMatrixWorld(true); selectObjs([o]);
    applyDisplacement('pattern', 'waben'); applyDisplacement('amp', '1'); await new Promise(r => setTimeout(r, 300));
    const allBefore = _T.stats(objects[0], 'cyl');          // Standard: außen+oben+innen → Deckel texturiert
    toggleTexPanel(); await new Promise(r => setTimeout(r, 100));
    const hit = _T.hit(o, new THREE.Vector3(3, 1, 0.2), new THREE.Vector3(-1, 0, 0));
    _texToggleFaceAt(o, hit);
    const st = _T.stats(o, 'cyl');
    return { allTop: allBefore.top, top: st.top, side: st.side, where: o.userData.texWhere, n: (o.userData.texFaces || []).length, bad: _T.watertight(o), panel: !!document.getElementById('tex-face-pick') };
  });
  ok(r1.where === 'flaechen' && r1.n === 1, 'Mantel angeklickt → Modus „Flächen", 1 Fläche');
  ok(r1.top < 1e-3, `Deckel bleibt glatt (Abweichung ${(r1.top*10).toFixed(3)} mm, vorher mit „oben" ${(r1.allTop*10).toFixed(2)} mm)`);
  ok(r1.side > 0.05, `Mantel hat Textur (bis ${(r1.side*10).toFixed(2)} mm)`);
  ok(r1.bad === 0, 'wasserdicht (offene Kanten ' + r1.bad + ')');
  // Speichern/Laden
  const r2 = await p.evaluate(() => {
    const o = objects[0], d = JSON.parse(JSON.stringify(objectToData(o)));
    const o2 = buildObjectFromData(d); scene.add(o2); objects.push(o2); o2.updateMatrixWorld(true);
    const st = _T.stats(o2, 'cyl'); const res = { faces: (o2.userData.texFaces || []).length, where: o2.userData.texWhere, top: st.top, side: st.side };
    scene.remove(o2); objects.pop(); return res;
  });
  ok(r2.faces === 1 && r2.where === 'flaechen' && r2.top < 1e-3 && r2.side > 0.05, 'Speichern/Laden: Auswahl + Ergebnis gleich');
  // Nochmal auf den Mantel → abwählen
  const r3 = await p.evaluate(() => { const o = objects[0]; const hit = _T.hit(o, new THREE.Vector3(0.2, 1, 3), new THREE.Vector3(0, 0, -1)); _texToggleFaceAt(o, hit); return { n: (o.userData.texFaces || []).length, where: o.userData.texWhere }; });
  ok(r3.n === 0 && r3.where === 'alle', 'zweiter Klick auf den Mantel wählt ab → wieder „Alle"');
  // ── Box 30×20×30: nur Oberseite ──
  const r4 = await p.evaluate(async () => {
    _newCreate(false); addShape('box'); const o = objects[0]; o.scale.set(1.5, 1.0, 1.5); o.position.set(0, 0, 0); o.updateMatrixWorld(true);
    o.position.y -= getMeshBox(o).min.y; o.updateMatrixWorld(true); selectObjs([o]);
    applyDisplacement('pattern', 'riffel'); applyDisplacement('amp', '1'); await new Promise(r => setTimeout(r, 300));
    const hit = _T.hit(o, new THREE.Vector3(0.2, 5, 0.3), new THREE.Vector3(0, -1, 0));
    _texToggleFaceAt(o, hit);
    const st = _T.stats(o, 'box');
    return { top: st.top, side: st.side, bad: _T.watertight(o) };
  });
  ok(r4.top > 0.05 && r4.side < 1e-3 && r4.bad === 0, `Box: Oberseite texturiert (${(r4.top*10).toFixed(2)} mm), Seite glatt (${(r4.side*10).toFixed(3)} mm), wasserdicht`);
  // Rückgängig
  const r5 = await p.evaluate(async () => { undo(); await new Promise(r => setTimeout(r, 300)); const o = objects[0]; return { n: (o.userData.texFaces || []).length, where: o.userData.texWhere || 'alle' }; });
  ok(r5.n === 0 && r5.where !== 'flaechen', 'Rückgängig nimmt die Flächenwahl zurück (' + r5.n + ' Flächen, ' + r5.where + ')');
  ok(r1.panel, 'Knopf „Flächen wählen" im Textur-Panel');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
