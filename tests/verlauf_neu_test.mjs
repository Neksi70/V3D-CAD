// Prägen, Folgen, Loft im Verlauf: nachrechnen + bearbeiten (v1.18.205)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8878;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 900));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
try {
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _featEdit === 'function', { timeout: 60000 });
  await p.evaluate(() => { try { hideStarter(); } catch (e) {}
    window._vg = g => { const gg = g.index ? g.toNonIndexed() : g, P = gg.attributes.position; let v = 0; const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
      for (let i = 0; i < P.count; i += 3) { A.fromBufferAttribute(P, i); B.fromBufferAttribute(P, i+1); C.fromBufferAttribute(P, i+2); v += A.dot(B.clone().cross(C)); } return Math.abs(v / 6) * 1000; };
    window._vo = o => { o.updateMatrixWorld(true); const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); return _vg(g); };
    window._wait = async (fn, n = 40) => { for (let i = 0; i < n && !fn(); i++) await new Promise(r => setTimeout(r, 150)); };
    window._rb = async o => { const g = await _featRebuild(_featClone(o.userData.feat)); return _vg(g); }; });

  // 1) Prägen
  let r = await p.evaluate(async () => { _newCreate(false); addShape('box'); objects[0].updateMatrixWorld(true); deselect();
    enterSketchMode(); _skSetFrame(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 2, 0)); _sk.ents = [{ type: 'line', a: { u: -0.6, v: 0 }, b: { u: 0.6, v: 0 } }]; _skRender();
    _embOpen(); Object.assign(_emb.p, { mode: 'cut', prof: 'v', w: 2, d: 1 }); await _embApply();
    await _wait(() => objects.length === 1 && !objects[0].userData.isHole && objects[0].userData.feat); await new Promise(r => setTimeout(r, 300));
    const o = objects[0], H = o.userData.feat; return { typ: H && H.list.map(f => f.typ).join(','), v: _vo(o), rb: await _rb(o), lab: H ? _featLabel(H.list[H.list.length - 1], H.list.length - 1) : '' }; });
  ok(/praegen/.test(r.typ) && Math.abs(r.v - r.rb) / r.v < 0.002, `Prägung im Verlauf (${r.typ}: ${r.lab}), Nachrechnen = Stand (${r.v.toFixed(1)} / ${r.rb.toFixed(1)})`);
  const v1 = r.v;
  r = await p.evaluate(async () => { const o = objects[0], k = o.userData.feat.list.length - 1; _featEdit(o.userData.id, k);
    const offen = _sk.active && !!_sk.editEmb && !!document.getElementById('emb-panel');
    _emb.p.d = 2; await _embApply(); await new Promise(r => setTimeout(r, 300));
    const o2 = objects[0]; return { offen, v: _vo(o2), d: o2.userData.feat.list[k].p.d, n: objects.length }; });
  ok(r.offen && r.n === 1 && r.d === 2 && r.v < v1 - 5, `Prägung bearbeitet: Tiefe 1 → 2 mm, Teil neu (${v1.toFixed(1)} → ${r.v.toFixed(1)} mm³)`);

  // 2) Folgen aus Skizze, an der oberen Zylinderkante; danach Profil im Verlauf vergrößern
  await p.evaluate(() => { _newCreate(false); addShape('cylinder'); objects[0].updateMatrixWorld(true); deselect(); setView('iso'); });
  const bb0 = await p.evaluate(() => { const bb = getMeshBox(objects[0]); return [bb.min.toArray(), bb.max.toArray()]; });
  await p.evaluate(([bb]) => { enterSketchMode(); _skSetFrame(new THREE.Vector3(0, 0, 1), new THREE.Vector3(bb[1][0], bb[1][1], 0));
    _sk.ents = [{ type: 'circle', c: { u: 0, v: 0 }, r: 0.15 }]; _skRender(); _flgFromSketch(); }, [bb0]);
  const s = await p.evaluate(([bb]) => { const v = new THREE.Vector3(0, bb[1][1], bb[1][2]).project(camera), rr = vpEl.getBoundingClientRect();
    return { x: rr.left + (v.x * 0.5 + 0.5) * rr.width, y: rr.top + (-v.y * 0.5 + 0.5) * rr.height }; }, [bb0]);
  await p.mouse.move(s.x - 20, s.y + 20); await p.mouse.move(s.x, s.y, { steps: 6 }); await p.mouse.click(s.x, s.y); await p.waitForTimeout(300);
  await p.keyboard.press('Enter'); await p.waitForTimeout(2500);
  r = await p.evaluate(async () => { const o = objects[0], H = o.userData.feat; return { n: objects.length, typ: H && H.list.map(f => f.typ).join(','), sk: !!(H && H.list[H.list.length - 1].sk), v: _vo(o), rb: H ? await _rb(o) : 0, w: getMeshBox(o).max.x * 10 }; });
  ok(r.n === 1 && /folgen/.test(r.typ) && r.sk && Math.abs(r.v - r.rb) / r.v < 0.003, `Folgen im Verlauf mit Profil-Skizze (${r.typ}), Nachrechnen = Stand`);
  const w1 = r.w;
  r = await p.evaluate(async () => { const o = objects[0], k = o.userData.feat.list.length - 1; _featEdit(o.userData.id, k);
    const offen = _sk.active && !!_sk.editFlg; _sk.ents[0].r = 0.25; _flgFromSketch();
    await new Promise(r => setTimeout(r, 2000)); const o2 = objects[0]; return { offen, w: getMeshBox(o2).max.x * 10, n: objects.length }; });
  ok(r.offen && r.n === 1 && Math.abs(r.w - w1 - 1) < 0.1, `Folgen bearbeitet: Profil r 1,5 → 2,5 mm, Wulst wächst um 1 mm (${w1.toFixed(2)} → ${r.w.toFixed(2)})`);

  // 3) Loft im Verlauf, bearbeiten, dann Skizze anfügen
  r = await p.evaluate(async () => { _newCreate(false); addShape('box'); addShape('box'); const [a, c] = objects; a.position.set(0, 1, 0); c.position.set(0, 7, 0); c.scale.set(0.5, 1, 0.5);
    objects.forEach(o => o.updateMatrixWorld(true)); deselect(); enterLoftMode();
    raycaster.set(new THREE.Vector3(0, 50, 0.3), new THREE.Vector3(0, -1, 0)); _lfPickFace(raycaster.intersectObject(a)[0]);
    raycaster.set(new THREE.Vector3(0.1, -50, 0.1), new THREE.Vector3(0, 1, 0)); _lfPickFace(raycaster.intersectObject(c)[0]);
    _lfApply(); const o = objects[objects.length - 1]; return { typ: o.userData.feat && o.userData.feat.list[0].typ, v: _vo(o), rb: await _rb(o) }; });
  ok(r.typ === 'loft' && Math.abs(r.v - r.rb) / r.v < 0.002, `Loft im Verlauf, Nachrechnen = Stand (${r.v.toFixed(1)} / ${r.rb.toFixed(1)})`);
  r = await p.evaluate(async () => { const o = objects[objects.length - 1]; _featEdit(o.userData.id, 0); const el = document.getElementById('lfe-panel');
    el.querySelector('#lfe-n').value = '24'; el.querySelector('#lfe-ok').click(); await new Promise(r => setTimeout(r, 800));
    return { sides: o.userData.feat.list[0].sides, tris: o.geometry.attributes.position.count / 3 }; });
  ok(r.sides === 24, `Loft bearbeitet: 24 Seiten (${r.tris} Dreiecke)`);
  r = await p.evaluate(async () => { const o = objects[objects.length - 1]; const keep = objects.filter(x => x !== o); keep.forEach(x => { scene.remove(x); objects.splice(objects.indexOf(x), 1); });
    selectObjs([o]); enterSketchMode(); const bb = getMeshBox(o); _skSetFrame(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, bb.max.y, 0)); _sk.onFace = true;
    _sk.ents = [{ type: 'circle', c: { u: 0, v: 0 }, r: 0.2 }]; _skRender(); _skExtrude(); _skxSet('end', 'dist'); _skxSet('dir', 'one'); _skxSet('op', 'join'); _skxSet('d', '5'); await _skxApply();
    await new Promise(r => setTimeout(r, 500)); const o2 = objects[0]; return { n: objects.length, typ: o2.userData.feat && o2.userData.feat.list.map(f => f.typ).join(','), v: _vo(o2), rb: await _rb(o2) }; });
  ok(r.n === 1 && r.typ === 'loft,skizze' && Math.abs(r.v - r.rb) / r.v < 0.003, `Loft + angefügte Skizze im selben Verlauf (${r.typ}), Nachrechnen stimmt`);
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} catch (e) { console.log('ABBRUCH ' + String(e.message || e).split('\n')[0]); fail++; }
await b.close(); srv.kill();
console.log(fail ? `${fail} FEHLER` : 'ALLES OK'); process.exit(fail ? 1 : 0);
