// Regressionstest für den Generator „Dinosaurier" (🦖, _dno*).
//   1. alle Arten fein bauen: Teile zusammenhängend, Volumen > 0, Länge stimmt
//   2. beweglich: Beine/Arme schwenken ±Hub ohne den Rumpf zu berühren, in Ruhe Abstand
//      ≥ Spalt; Stift sitzt frei im Bein, stramm im Rumpf; jenseits des Hubs Anschlag
//   3. Standfestigkeit: Schwerpunkt über der Fußfläche (Pose 0)
//   4. Druckplatte: alles auf z = 0, keine Überlappung, Überhänge gering
//   5. Fenster, Vorschau, Erstellen, Im Generator bearbeiten, Speichern/Laden
//   6. Maul (Unterkiefer): eigenes Teil, wasserdicht, Stift stramm in der Zunge/mit Spiel im Kiefer, öffnet 0–35°
//      frei, Anschlag danach, schließt nicht durch den Oberkiefer, kopfüber flach auf dem Bett
//   7. Zähne (Raubsaurier Zahnreihen, Pflanzenfresser Stift-/Blattzähne bzw. Hornschnabel) + Krallen: Maul-Prüfungen aus 6
//      laufen mit Zähnen (Standard an); ohne Kiefer Zähne in der Maulspalte; Krallen ohne zusätzlichen Überhang;
//      Optionen im Fenster, alte Dinos öffnen mit Zähnen/Krallen aus
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
      // Maul
      let kf = null;
      if (r.raw.jaw) {
        const jaw = r.raw.jaw, k = r.kiefer, pinK = r.raw.pinK.m;
        const rotK = a => K(K(K(jaw.translate([0, -k.yh, -k.zh])).rotate([-a, 0, 0])).translate([0, k.yh, k.zh]));
        // wasserdicht: jede Kante genau einmal in jeder Richtung
        const wd = m => { const g = m.getMesh(), t = g.triVerts, e = new Map();
          for (let i = 0; i < t.length; i += 3) for (let j = 0; j < 3; j++) { const a = t[i + j], b = t[i + (j + 1) % 3], key = a + ',' + b; e.set(key, (e.get(key) || 0) + 1); }
          for (const [key, n] of e) { const [a, b] = key.split(','); if (n !== 1 || e.get(b + ',' + a) !== 1) return false; } return t.length > 0; };
        const d = jaw.decompose(); const stuecke = d.length; d.forEach(x => x.delete());
        const frei = []; for (let a = 0; a <= _DNO_MAUL_HUB; a += 5) frei.push(+sch(body, rotK(a)).toFixed(3));
        const pb = pinK.boundingBox(), pl = pb.max[0] - pb.min[0];
        const pK = K(K(pinK.translate([-(pb.max[0] + pb.min[0]) / 2, 0, 0])).translate([0, k.yh, k.zh]));
        // Stiftenden stehen nicht über: Kiefer reicht knapp über dem Loch weiter nach außen als der Stift
        const zs = k.zh + (k.dp + _DNO_SPIEL[p.gelenk]) / 2 + 0.5;
        const achse = K(jaw.intersect(K(K(M.cube([400, 0.3, 0.3])).translate([-200, k.yh - 0.15, zs - 0.15])))).boundingBox();
        kf = { stuecke, wd: wd(jaw) && wd(body), vol: jaw.volume(), frei, anschlag: sch(body, rotK(_DNO_MAUL_HUB + 25)), zu: sch(body, rotK(-8)),
          ruhe: body.minGap(jaw, 1), beine: Math.min(legR.minGap(rotK(_DNO_MAUL_HUB), 2), armR.minGap(rotK(_DNO_MAUL_HUB), 2)),
          sRumpf: body.minGap(pK, 1), sKiefer: jaw.minGap(pK, 1), sSchnitt: sch(body, pK) + sch(jaw, pK),
          buendig: [pl / 2, achse.max[0], -achse.min[0]], dp: k.dp };
      }
      return { ms, laenge, komp, klemm, bv, bvGap, stift, endeH, endeV, cy, fuss, dp: [H.dp, V.dp], kf, klein: r.maulKlein, zahn: r.zahn };
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
  // Zähne: Raubsaurier Reihen oben + unten, Pflanzenfresser mit Kiefer Zähne oder Schnabel (Diplo/Stego: Kopf zu klein → keine)
  const zf = { trex: 'zahn', raptor: 'zahn', spino: 'kegel', brachio: 'stift', ankylo: 'schnabel', trike: 'schnabel', parasaur: 'schnabel', pachy: 'blatt' }[art];
  if (zf) ok(art + ': Zähne/Schnabel (' + zf + ') am Kiefer', r.zahn && r.zahn.form === zf && r.zahn.mode === 'kiefer' && r.zahn.oben >= 2
    && (zf === 'schnabel' || r.zahn.unten >= 2) && (!['zahn', 'kegel'].includes(zf) || (r.zahn.oben >= 6 && r.zahn.unten >= 6)), r.zahn);
  ok(art + ': steht (Schwerpunkt über den Füßen)', r.cy > r.fuss[0] + 1 && r.cy < r.fuss[1] - 1, [+r.cy.toFixed(1), r.fuss.map(v => +v.toFixed(1))]);
  // Maul: bei 160 mm haben Diplodocus und Stegosaurus zu kleine Köpfe → Hinweis statt Kiefer
  if (['diplo', 'stego'].includes(art)) { ok(art + ': Kopf zu klein → kein Kiefer, Hinweis mit Mindestlänge', !r.kf && r.klein > 160, r.klein); continue; }
  const k = r.kf;
  ok(art + ': Unterkiefer vorhanden (Stift Ø ≥ 2 mm)', !!k && k.dp >= 2, k && +k.dp.toFixed(2));
  if (!k) continue;
  ok(art + ': Unterkiefer ein Stück, Kiefer + Rumpf wasserdicht', k.stuecke === 1 && k.wd && k.vol > 50, [k.stuecke, k.wd, +k.vol.toFixed(0)]);
  ok(art + ': Maul öffnet 0–' + 35 + '° ohne zu klemmen', k.frei.every(v => v < 0.01), k.frei);
  ok(art + ': Anschlag beim Öffnen, schließt nicht durch den Oberkiefer', k.anschlag > 0.05 && k.zu > 0.05, [+k.anschlag.toFixed(2), +k.zu.toFixed(2)]);
  ok(art + ': Kiefer berührt in Ruhe nichts (Spalt ≥ 0,3), offen nicht die Glieder', k.ruhe > 0.3 && k.beine > 0.3, [+k.ruhe.toFixed(2), +k.beine.toFixed(2)]);
  ok(art + ': Kieferstift stramm in der Zunge, mit Spiel im Kiefer', k.sSchnitt < 0.01 && k.sRumpf < 0.08 && k.sKiefer > 0.1 && k.sKiefer < 0.16,
    [k.sRumpf, k.sKiefer, k.sSchnitt].map(v => +v.toFixed(3)));
  ok(art + ': Kieferstift steht seitlich nicht über', k.buendig[0] < k.buendig[1] && k.buendig[0] < k.buendig[2], k.buendig.map(v => +v.toFixed(2)));
}

// Ohne Kiefer (Maul aus / Kopf zu klein): Raubsaurier-Zähne in der Maulspalte, Rumpf ein Stück + wasserdicht; Zähne aus = alter Kopf
for (const [art, extra] of [['trex', { maul: false }], ['spino', { maul: false }], ['raptor', { laenge: 110 }], ['raptor', { laenge: 110, zaehne: false }]]) {
  const r = await pg.evaluate(([art, extra]) => { const r = _dnoBuild(_mfWasm, { ..._DNO_DEF, art, anordnung: 'figur', beinW: 0, armW: 0, ...extra }, 'vorschau');
    try { const b = r.raw.body, d = b.decompose(), n = d.length; d.forEach(x => x.delete());
      const g = b.getMesh(), t = g.triVerts, e = new Map();
      for (let i = 0; i < t.length; i += 3) for (let j = 0; j < 3; j++) { const k = t[i + j] + ',' + t[i + (j + 1) % 3]; e.set(k, (e.get(k) || 0) + 1); }
      let wd = t.length > 0; for (const [k, c] of e) { const [a, bb] = k.split(','); if (c !== 1 || e.get(bb + ',' + a) !== 1) { wd = false; break; } }
      return { jaw: !!r.raw.jaw, zahn: r.zahn, n, wd }; } finally { _dnoFree(r); } }, [art, extra]);
  const name = art + ' ' + JSON.stringify(extra);
  if (extra.zaehne === false) ok(name + ': ohne Zähne keine Zähne', !r.zahn && !r.jaw && r.n === 1, r);
  else ok(name + ': Zähne oben + unten in der Maulspalte, Rumpf ein Stück + wasserdicht', !r.jaw && r.zahn && r.zahn.mode === 'spalt' && r.zahn.oben >= 4 && r.zahn.unten >= 4 && r.n === 1 && r.wd, r);
}
// Pflanzenfresser ohne Kiefer: keine Relief-Stummel
{
  const r = await pg.evaluate(() => { const r = _dnoBuild(_mfWasm, { ..._DNO_DEF, art: 'stego' }, 'vorschau'); try { return { zahn: r.zahn, jaw: !!r.raw.jaw }; } finally { _dnoFree(r); } });
  ok('Stegosaurus (Kopf zu klein): keine Zähne/kein Schnabel als Relief', !r.zahn && !r.jaw, r);
}
// Krallen: Beine/Arme bleiben ein Stück, Form geändert, Überhang der Glieder (Drucklage) nicht schlechter
for (const art of ['trex', 'raptor', 'brachio', 'parasaur']) {
  const r = await pg.evaluate((art) => {
    const ueber = m => { const g = m.getMesh(), v = g.vertProperties, np = g.numProp, tv = g.triVerts; let A = 0;
      for (let i = 0; i < tv.length; i += 3) { const a = tv[i] * np, b = tv[i + 1] * np, c = tv[i + 2] * np;
        const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2], wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, n = Math.hypot(nx, ny, nz) || 1;
        if ((v[a + 2] + v[b + 2] + v[c + 2]) / 3 > 0.4 && nz / n < -Math.cos(55 * Math.PI / 180)) A += n / 2; } return A; };
    const res = {};
    for (const kr of [false, true]) {
      const r = _dnoBuild(_mfWasm, { ..._DNO_DEF, art, anordnung: 'druck', krallen: kr, zaehne: false }, 'vorschau');
      try { const L = r.out.find(t => t.teil === 'legR').mf, A = r.out.find(t => t.teil === 'armR').mf;
        const dl = L.decompose(), da = A.decompose(); res[kr] = { st: [dl.length, da.length], u: +(ueber(L) + ueber(A)).toFixed(1), h: L.boundingBox().max[2], vol: +L.volume().toFixed(1) };
        dl.forEach(x => x.delete()); da.forEach(x => x.delete()); } finally { _dnoFree(r); }
    }
    return res;
  }, art);
  ok(art + ': Krallen – Bein/Arm je ein Stück, Form geändert, kein zusätzlicher Überhang', r.true.st[0] === 1 && r.true.st[1] === 1
    && Math.abs(r.true.vol - r.false.vol) > 1 && r.true.u <= r.false.u + 2, { mit: r.true, ohne: r.false });
  if (art === 'raptor') ok('raptor: Sichelkralle liegt auf der Innenseite (Bein in Drucklage nicht höher)', r.true.h <= r.false.h + 0.3, [r.true.h, r.false.h].map(v => +v.toFixed(2)));
}

// Maul abgeschaltet → kein Kiefer, alte Teilezahl
{
  const r = await pg.evaluate(() => { const r = _dnoBuild(_mfWasm, { ..._DNO_DEF, art: 'trex', maul: false }, 'vorschau');
    try { return { jaw: !!r.raw.jaw, n: r.out.length, teile: r.out.map(t => t.teil) }; } finally { _dnoFree(r); } });
  ok('Maul aus: kein Unterkiefer, 8 Teile', !r.jaw && r.n === 8, r);
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
        const g = t.mf.getMesh(), v = g.vertProperties, np = g.numProp, tv = g.triVerts; let A = 0, A45 = 0, Ab = 0;
        for (let i = 0; i < tv.length; i += 3) {
          const a = tv[i] * np, b = tv[i + 1] * np, c = tv[i + 2] * np;
          const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2], wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
          const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, n = Math.hypot(nx, ny, nz) || 1;
          const zc = (v[a + 2] + v[b + 2] + v[c + 2]) / 3;
          if (zc > 0.4 && nz / n < -Math.cos(55 * Math.PI / 180)) A += n / 2;
          if (zc > 0.4 && nz / n < -Math.cos(43 * Math.PI / 180)) A45 += n / 2;      // steiler als 45° + 2° (echter Überhang)
          Ab += n / 2;
        }
        f.ueber.push([t.teil, +A.toFixed(0), +(100 * A / Ab).toFixed(1), +(100 * A45 / Ab).toFixed(1)]);
      }
      for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
        const x = L[i].mf.intersect(L[j].mf), v = x.volume(); x.delete();
        if (v > 0.01) f.ueberlapp.push(L[i].teil + '/' + L[j].teil + ':' + v.toFixed(2));
      }
      let bb = [1e9, 1e9, -1e9, -1e9]; for (const t of L) { const q = t.mf.boundingBox(); bb = [Math.min(bb[0], q.min[0]), Math.min(bb[1], q.min[1]), Math.max(bb[2], q.max[0]), Math.max(bb[3], q.max[1])]; }
      f.platte = [bb[2] - bb[0], bb[3] - bb[1]].map(v => Math.round(v));
      const j = L.find(t => t.teil === 'jaw');
      if (j) { const sl = j.mf.intersect(_mfWasm.Manifold.cube([2000, 2000, 0.2]).translate([-1000, -1000, 0])); f.auflage = sl.volume() / 0.2; sl.delete(); }
      f.n = L.length;
      return f;
    } finally { _dnoFree(r); }
  }, art);
  ok(art + ' Druckplatte: alles auf z = 0', r.zmin.length === 0, r.zmin);
  ok(art + ' Druckplatte: Teile überlappen nicht (außer Platten auf dem Rumpf)', r.ueberlapp.length === 0, r.ueberlapp);
  // Unterkiefer mit Zähnen/Schnabel: die Zahnkerben haben 45°-Flanken (Kompromiss: Schädelhälften und Kiefer liegen beim Druck
  // um 90° verschieden) → dort zählt der echte Überhang (> 47°), das grobe Maß darf bis 6 %
  const max = Math.max(...r.ueber.filter(u => u[0] !== 'jaw').map(u => u[2]));
  ok(art + ' Druckplatte: Überhänge > 55° unter 4 % je Teil', max < 4, r.ueber.filter(u => u[2] >= 1));
  const jw = r.ueber.find(u => u[0] === 'jaw');
  if (jw) ok(art + ' Druckplatte: Unterkiefer mit Zähnen – Überhang steiler als 45° unter 2 %, grob unter 6 %', jw[3] < 2 && jw[2] < 6, jw);
  if (!['diplo', 'stego'].includes(art)) ok(art + ' Druckplatte: Unterkiefer liegt flach (Maulseite unten)', r.auflage > 40, r.auflage && +r.auflage.toFixed(0));
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
  ok('Infotext: Stegosaurus-Kopf zu klein fürs Maul', /zu klein für einen beweglichen Unterkiefer/.test(v.info), v.info.slice(-200));
  const cb = await pg.evaluate(() => { const c = document.getElementById('dno-maul'); const a = c && c.checked;
    _dnoStr('art', 'trex'); const t = document.getElementById('dno-info').textContent; _dnoStr('art', 'stego'); return { da: !!c, an: a, t }; });
  const zk = await pg.evaluate(() => { const z = document.getElementById('dno-zaehne'), k = document.getElementById('dno-krallen');
    return { z: z && z.checked, k: k && k.checked, def: [_DNO_DEF.zaehne, _DNO_DEF.krallen], zt: document.getElementById('dno-zaehne-txt').textContent }; });
  ok('Optionen „Zähne“ und „Krallen“ da und Standard an (Stego: Hornschnabel)', zk.z === true && zk.k === true && zk.def.every(v => v === true) && /Hornschnabel/.test(zk.zt), zk);
  ok('Option „Maul beweglich“ da und Standard an, Infotext T-Rex nennt Unterkiefer', cb.da && cb.an && /Unterkiefer/.test(cb.t) && /10 Teile/.test(cb.t), cb);
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
  await pg.waitForFunction(() => objects.length === 10 && objects[0].userData.dinoParams.art === 'trike', { timeout: 120000 }).catch(() => {});
  const e2 = await pg.evaluate(() => ({ n: objects.length, art: objects.map(o => o.userData.dinoParams && o.userData.dinoParams.art), names: objects.map(o => o.userData.name) }));
  ok('Übernehmen ersetzt den Dino (Triceratops, 10 Teile mit Unterkiefer + Kieferstift)', e2.n === 10 && e2.art.every(a => a === 'trike')
    && e2.names.some(n => /Unterkiefer/.test(n)) && e2.names.some(n => /Stift Kiefer/.test(n)), e2);
  const s = await pg.evaluate(() => { const d = objectToData(objects[0]); const o = buildObjectFromData(d); return { p: o && o.userData.dinoParams, set: o && o.userData.dnoSet === objects[0].userData.dnoSet }; });
  ok('Speichern/Laden behält die Generator-Einstellungen (inkl. Maul, Zähne, Krallen)', s.p && s.p.art === 'trike' && s.p.maul === true && s.p.zaehne === true && s.p.krallen === true && s.set, s);
  // Im Generator bearbeiten: Maul abschalten → 8 Teile; alter Dino ohne Maul-Angabe öffnet mit Maul aus
  await pg.evaluate(() => { _dnoEdit(objects.find(o => /Unterkiefer/.test(o.userData.name))); _dnoStr('maul', false); return _dnoCreate(); });
  await pg.waitForFunction(() => objects.length === 8, { timeout: 120000 }).catch(() => {});
  const e3 = await pg.evaluate(() => ({ n: objects.length, maul: objects[0].userData.dinoParams.maul }));
  ok('Bearbeiten: Maul abschalten ersetzt durch 8 Teile', e3.n === 8 && e3.maul === false, e3);
  const e4 = await pg.evaluate(() => { const o = objects[0]; const alt = { ...o.userData.dinoParams }; delete alt.maul; delete alt.maulW; delete alt.zaehne; delete alt.krallen; o.userData.dinoParams = alt;
    _dnoEdit(o); const r = { maul: _dnoP.maul, cb: document.getElementById('dno-maul').checked, zaehne: _dnoP.zaehne, krallen: _dnoP.krallen,
      zcb: document.getElementById('dno-zaehne').checked, kcb: document.getElementById('dno-krallen').checked }; _dnoClose(); return r; });
  ok('Alter Dino (ohne Maul-/Zähne-/Krallen-Angabe) öffnet mit allem aus', e4.maul === false && e4.cb === false && e4.zaehne === false && e4.krallen === false && !e4.zcb && !e4.kcb, e4);
  await pg.evaluate(() => { undo(); });
  const u = await pg.evaluate(() => { undo(); return objects.length; });
  ok('Rückgängig stellt den Stegosaurus wieder her', u === 10, u);
}

ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? `\n${fails.length} FEHLER` : '\nalles OK');
process.exit(fails.length ? 1 : 0);
