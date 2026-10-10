// Regressionstest für den Generator „Dinosaurier" (🦖, _dno*).
//   1. alle Arten fein bauen: Teile zusammenhängend, Volumen > 0, Länge stimmt
//   2. beweglich: Beine/Arme schwenken ±Hub ohne den Rumpf zu berühren, in Ruhe Abstand
//      ≥ Spalt; Stift sitzt frei im Bein, stramm im Rumpf; jenseits des Hubs Anschlag
//   3. Standfestigkeit: Schwerpunkt über der Fußfläche (Pose 0)
//   4. Druckplatte: alles auf z = 0, keine Überlappung, Überhänge gering
//   5. Fenster, Vorschau, Erstellen, Im Generator bearbeiten, Speichern/Laden
// Start: python3 volme3d_server.py 8853 --dev   →   V3D_URL=http://127.0.0.1:8853/volme3d.html node tests/dino_test.mjs
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
});
await pg.evaluate(async () => { await _mfInit(); });

const arten = (ONLY || ['trex', 'raptor', 'spino', 'brachio', 'diplo', 'stego', 'ankylo', 'trike', 'parasaur', 'pachy']);
for (const art of arten) {
  const r = await pg.evaluate((art) => {
    const M = _mfWasm.Manifold, f = [];
    const p = { ..._DNO_DEF, art, anordnung: 'figur', beinW: 0, armW: 0 };
    const t0 = performance.now();
    const r = _dnoBuild(_mfWasm, p, 'fein');
    const ms = Math.round(performance.now() - t0);
    const tmp = [], K = x => { tmp.push(x); return x; };
    try {
      const { body, legR, armR } = r.raw, pinH = r.raw.pinH.m, pinV = r.raw.pinV.m, H = r.hin, V = r.vor, sp = _DNO_SPIEL[p.gelenk];
      const rotX = (m, a, G) => K(K(K(m.translate([0, -G.jy, -G.jz])).rotate([a, 0, 0])).translate([0, G.jy, G.jz]));
      const sch = (a, b) => { const x = K(a.intersect(b)); return x.volume(); };
      // Länge
      let y0 = 1e9, y1 = -1e9; for (const t of r.out) { const bb = t.mf.boundingBox(); y0 = Math.min(y0, bb.min[1]); y1 = Math.max(y1, bb.max[1]); }
      const laenge = y1 - y0;
      // Teile zusammenhängend
      const komp = {}; for (const [k, m] of [['Rumpf', body], ['Bein', legR], ['Arm', armR]]) { const d = m.decompose(); komp[k] = d.length; d.forEach(x => x.delete()); }
      // Schwenken
      let klemm = [];
      for (const [nm, leg, G] of [['Bein', legR, H], ['Arm', armR, V]]) {
        for (let a = -_DNO_HUB; a <= _DNO_HUB; a += 5) { const v = sch(body, rotX(leg, a, G)); if (v > 0.01) klemm.push(nm + '@' + a + '°:' + v.toFixed(2)); }
        const gap = body.minGap(leg, 1); if (gap < _DNO_SPALT - 0.05) klemm.push(nm + ' Ruhe-Abstand ' + gap.toFixed(2));
        // Anschlag: deutlich jenseits des Hubs stößt es an (vorwärts oder rückwärts)
        const an = Math.max(sch(body, rotX(leg, _DNO_HUB + 25, G)), sch(body, rotX(leg, -_DNO_HUB - 25, G)));
        if (an < 0.05) klemm.push(nm + ' ohne Anschlag');
      }
      // Bein gegen Arm/Vorderbein, gleichsinnig geschwenkt (Laufen)
      let bv = 0; for (const a of [-30, 0, 30]) bv = Math.max(bv, sch(rotX(legR, a, H), rotX(armR, a, V)));
      const bvGap = legR.minGap(armR, 1);
      // Stifte: an ihren Platz (Mitte), Schnitt mit Rumpf > 0 (stramm), mit Bein ≈ 0 (Spiel)
      const pin = (P, G) => K(K(P.translate([-(P.boundingBox().max[0] + P.boundingBox().min[0]) / 2, 0, 0])).translate([0, G.jy, G.jz]));
      const pH = pin(pinH, H), pV = pin(pinV, V);
      const stift = { hRumpf: body.minGap(pH, 1), hBein: legR.minGap(pH, 1), vRumpf: body.minGap(pV, 1), vBein: armR.minGap(pV, 1),
        schnitt: sch(body, pH) + sch(legR, pH) + sch(body, pV) + sch(armR, pV),
        hIn: H.tief, vIn: V.tief, hLen: pinH.boundingBox().max[0] - pinH.boundingBox().min[0] };
      // reicht der Stift ins Bein? Ende liegt ≥ 70 % der Lochtiefe im Bein
      const endeH = (stift.hLen / 2) - H.x0, endeV = (pinV.boundingBox().max[0] - pinV.boundingBox().min[0]) / 2 - V.x0;
      // Schwerpunkt
      const com = m => { const g = m.getMesh(), v = g.vertProperties, np = g.numProp, t = g.triVerts; let VV = 0, cy = 0;
        for (let i = 0; i < t.length; i += 3) { const a = t[i] * np, b = t[i + 1] * np, c = t[i + 2] * np;
          const vol = (v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c])) / 6;
          VV += vol; cy += vol * (v[a + 1] + v[b + 1] + v[c + 1]) / 4; } return [VV, cy]; };
      let VV = 0, CY = 0; for (const m of [body, legR, armR]) { const [v, c] = com(m); const fk = m === body ? 1 : 2; VV += v * fk; CY += c * fk; }
      if (r.raw.deko) { const [v, c] = com(r.raw.deko); VV += v; CY += c; }
      const fy = []; for (const m of [legR, armR]) { if (m.boundingBox().min[2] < 0.5) { const sl = K(m.intersect(K(K(M.cube([800, 800, 0.6])).translate([-400, -400, 0])))); const bb = sl.boundingBox(); fy.push(bb.min[1], bb.max[1]); } }
      const cy = CY / VV, fuss = [Math.min(...fy), Math.max(...fy)];
      return { ms, laenge, komp, klemm, bv, bvGap, stift, endeH, endeV, cy, fuss, dp: [H.dp, V.dp] };
    } finally { tmp.forEach(x => { try { x.delete(); } catch (e) {} }); _dnoFree(r); }
  }, art);
  console.log(`— ${art}: ${r.ms} ms, Stifte Ø ${r.dp.map(v => v.toFixed(1)).join('/')}`);
  ok(art + ': Länge = 160 mm', Math.abs(r.laenge - 160) < 1.5, +r.laenge.toFixed(1));
  ok(art + ': Rumpf/Bein/Arm je ein Stück', r.komp.Rumpf === 1 && r.komp.Bein === 1 && r.komp.Arm === 1, r.komp);
  ok(art + ': Glieder schwenken frei, mit Anschlag', r.klemm.length === 0, r.klemm.slice(0, 6));
  ok(art + ': Hinter- und Vorderbein stoßen nicht beim Laufen', r.bv < 0.05 && r.bvGap > 0.3, [+r.bv.toFixed(2), +r.bvGap.toFixed(2)]);
  // Spalt radial: Rumpf = Presssitz/2 (0,05), Bein = Spiel/2 (0,125 bei „mittel“)
  ok(art + ': Stifte stramm im Rumpf, mit Spiel im Bein', r.stift.schnitt < 0.01 && r.stift.hRumpf < 0.08 && r.stift.vRumpf < 0.08
    && r.stift.hBein > 0.1 && r.stift.hBein < 0.16 && r.stift.vBein > 0.1 && r.stift.vBein < 0.16,
    [r.stift.hRumpf, r.stift.hBein, r.stift.vRumpf, r.stift.vBein, r.stift.schnitt].map(v => +v.toFixed(3)));
  ok(art + ': Stift reicht tief ins Bein', r.endeH > r.stift.hIn * 0.8 - 0.5 && r.endeV > r.stift.vIn * 0.8 - 0.5 && r.endeH <= r.stift.hIn + 0.01, [+r.endeH.toFixed(2), +r.stift.hIn.toFixed(2), +r.endeV.toFixed(2), +r.stift.vIn.toFixed(2)]);
  ok(art + ': steht (Schwerpunkt über den Füßen)', r.cy > r.fuss[0] + 1 && r.cy < r.fuss[1] - 1, [+r.cy.toFixed(1), r.fuss.map(v => +v.toFixed(1))]);
}

// Druckplatte
for (const art of arten) {
  const r = await pg.evaluate((art) => {
    const p = { ..._DNO_DEF, art, anordnung: 'druck' };
    const r = _dnoBuild(_mfWasm, p, 'fein');
    try {
      const L = r.out, f = { zmin: [], ueber: [], ueberlapp: [] };
      for (const t of L) {
        const bb = t.mf.boundingBox(); if (Math.abs(bb.min[2]) > 0.01) f.zmin.push(t.teil + ':' + bb.min[2].toFixed(2));
        // Überhang: nach unten zeigende Flächen steiler als 55° über z > 0,4 (Fläche in mm²)
        const g = t.mf.getMesh(), v = g.vertProperties, np = g.numProp, tv = g.triVerts; let A = 0, Ab = 0;
        for (let i = 0; i < tv.length; i += 3) {
          const a = tv[i] * np, b = tv[i + 1] * np, c = tv[i + 2] * np;
          const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2], wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
          const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, n = Math.hypot(nx, ny, nz) || 1;
          const zc = (v[a + 2] + v[b + 2] + v[c + 2]) / 3;
          if (zc > 0.4 && nz / n < -Math.cos(55 * Math.PI / 180)) A += n / 2;
          Ab += n / 2;
        }
        f.ueber.push([t.teil, +A.toFixed(0), +(100 * A / Ab).toFixed(1)]);
      }
      for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
        const x = L[i].mf.intersect(L[j].mf), v = x.volume(); x.delete();
        if (v > 0.01) f.ueberlapp.push(L[i].teil + '/' + L[j].teil + ':' + v.toFixed(2));
      }
      let bb = [1e9, 1e9, -1e9, -1e9]; for (const t of L) { const q = t.mf.boundingBox(); bb = [Math.min(bb[0], q.min[0]), Math.min(bb[1], q.min[1]), Math.max(bb[2], q.max[0]), Math.max(bb[3], q.max[1])]; }
      f.platte = [bb[2] - bb[0], bb[3] - bb[1]].map(v => Math.round(v));
      f.n = L.length;
      return f;
    } finally { _dnoFree(r); }
  }, art);
  ok(art + ' Druckplatte: alles auf z = 0', r.zmin.length === 0, r.zmin);
  ok(art + ' Druckplatte: Teile überlappen nicht (außer Platten auf dem Rumpf)', r.ueberlapp.length === 0, r.ueberlapp);
  const max = Math.max(...r.ueber.map(u => u[2]));
  ok(art + ' Druckplatte: Überhänge > 55° unter 4 % je Teil', max < 4, r.ueber.filter(u => u[2] >= 1));
  console.log('       Platte', r.platte.join(' × '), 'mm,', r.n, 'Teile');
}

// Fenster, Erstellen, Bearbeiten, Speichern
{
  await pg.evaluate(() => { _newCreate(false); _dnoP.art = 'stego'; _dnoOpen(); });
  await pg.waitForFunction(() => _gpv['dno'] && _gpv['dno'].group && _gpv['dno'].group.children.length, { timeout: 60000 }).catch(() => {});
  const v = await pg.evaluate(() => ({ show: document.getElementById('dno-modal').classList.contains('show'), mesh: !!(_gpv['dno'] && _gpv['dno'].group && _gpv['dno'].group.children.length),
    info: document.getElementById('dno-info').textContent, on: document.querySelector('#dno-art-bg .vtb.on').dataset.v }));
  ok('Fenster offen, Vorschau da, Stegosaurus markiert', v.show && v.mesh && v.on === 'stego', v);
  ok('Infotext nennt Platten als eigene Farbe', /Platten als eigene Farbe/.test(v.info), v.info.slice(0, 120));
  await pg.evaluate(() => _dnoCreate());
  await pg.waitForFunction(() => objects.length >= 10, { timeout: 120000 });
  const c = await pg.evaluate(() => ({ n: objects.length, names: objects.map(o => o.userData.name), farben: [...new Set(objects.map(o => o.userData.color))],
    set: new Set(objects.map(o => o.userData.dnoSet)).size, modal: document.getElementById('dno-modal').classList.contains('show') }));
  ok('Stegosaurus erstellt: 10 Teile, ein Set, Fenster zu', c.n === 10 && c.set === 1 && !c.modal, c);
  ok('Platten in eigener Farbe', c.farben.length === 3, c.farben);
  // Bearbeiten
  await pg.evaluate(() => { selectObjs([objects[0]]); updateFP(); });
  const btn = await pg.evaluate(() => !!document.querySelector('[onclick="_dnoEdit(getFirst())"]'));
  ok('Knopf „Im Generator bearbeiten“ im Eigenschaften-Feld', btn);
  await pg.evaluate(() => { _dnoEdit(objects[0]); });
  const e1 = await pg.evaluate(() => ({ art: _dnoP.art, go: document.getElementById('dno-go').textContent }));
  ok('Bearbeiten öffnet mit den Einstellungen', e1.art === 'stego' && /Übernehmen/.test(e1.go), e1);
  await pg.evaluate(() => { _dnoStr('art', 'trike'); return _dnoCreate(); });
  await pg.waitForFunction(() => objects.length === 8 && objects[0].userData.dinoParams.art === 'trike', { timeout: 120000 }).catch(() => {});
  const e2 = await pg.evaluate(() => ({ n: objects.length, art: objects.map(o => o.userData.dinoParams && o.userData.dinoParams.art) }));
  ok('Übernehmen ersetzt den Dino (Triceratops, 8 Teile)', e2.n === 8 && e2.art.every(a => a === 'trike'), e2);
  const s = await pg.evaluate(() => { const d = objectToData(objects[0]); const o = buildObjectFromData(d); return { p: o && o.userData.dinoParams, set: o && o.userData.dnoSet === objects[0].userData.dnoSet }; });
  ok('Speichern/Laden behält die Generator-Einstellungen', s.p && s.p.art === 'trike' && s.set, s);
  const u = await pg.evaluate(() => { undo(); return objects.length; });
  ok('Rückgängig stellt den Stegosaurus wieder her', u === 10, u);
}

ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? `\n${fails.length} FEHLER` : '\nalles OK');
process.exit(fails.length ? 1 : 0);
