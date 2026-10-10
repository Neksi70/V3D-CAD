// Regressionstest für den Generator „Minecraft-Figur" (⛏️, _mcf*).
//   1. alle Figuren × mehrfarbig/einfarbig bauen: jedes Teil wasserdicht, Volumen > 0
//   2. Höhe stimmt (Figur-Anordnung, Pose 0)
//   3. beweglich: in mehreren Posen berühren sich Rumpf, Kopf, Arme, Beine nicht,
//      die Stifte stecken frei bzw. stramm (Schnitt ≈ 0) in ihren Löchern
//   4. Druckplatte: Teile liegen auf y = 0, überlappen nicht, keine schrägen
//      Überhänge (flache Brücken über kleinen Löchern ausgenommen)
//   5. Erstellen / Im Generator bearbeiten / Speichern-Laden
// Start: python3 volme3d_server.py 8851 --dev   →   V3D_URL=http://127.0.0.1:8851/volme3d.html node tests/minecraft_test.mjs
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
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

// Hilfsfunktionen im Browser
await pg.evaluate(() => {
  window._mcfT = {
    teileMf(r){                                                            // je Körperteil ein Manifold (Farbteile vereint)
      const W = _mfWasm, by = {};
      for (const t of r.teile) {
        const m = _mfFromSoup(W, t.geo.toNonIndexed().attributes.position.array);
        (by[t.teil] = by[t.teil] || []).push(m);
      }
      const out = {};
      for (const [k, arr] of Object.entries(by)) out[k] = arr.length === 1 ? arr[0] : W.Manifold.union(arr);
      return out;
    },
    schnitt(a, b){ const x = a.intersect(b); const v = x.volume(); x.delete(); return v; },
  };
});

const figuren = ['steve', 'alex', 'zombie', 'skelett', 'enderman'];
for (const fig of figuren) for (const farbig of [1, 0]) {
  const r = await pg.evaluate(([fig, farbig]) => {
    Object.assign(_mcfP, _MCF_DEF, { figur: fig, farbig, anordnung: 'figur', armW: 0, beinW: 0 });
    const t0 = performance.now();
    const res = _mcfBuild(_mfWasm, _mcfP, 'fein');
    const ms = Math.round(performance.now() - t0);
    let schlecht = [], yMin = 1e9, yMax = -1e9;
    for (const t of res.teile) {
      const pos = t.geo.attributes.position.array;
      for (let i = 1; i < pos.length; i += 3) { yMin = Math.min(yMin, pos[i]); yMax = Math.max(yMax, pos[i]); }
      if (!(t.vol > 0)) schlecht.push(t.teil + '/' + t.key);
    }
    const farben = new Set(res.teile.map(t => t.col)).size;
    return { ms, n: res.teile.length, farben, schlecht, H: yMax - yMin, Ht: res.d.Ht, y0: yMin };
  }, [fig, farbig]);
  const nm = fig + (farbig ? ' mehrfarbig' : ' einfarbig');
  console.log(nm, JSON.stringify(r));
  ok(nm + ': alle Teile mit Volumen', r.schlecht.length === 0, r.schlecht);
  ok(nm + ': Höhe ' + r.Ht.toFixed(1), Math.abs(r.H - r.Ht) < 0.05 && Math.abs(r.y0) < 1e-3, r.H);
  ok(nm + ': Teilezahl', farbig ? r.n > 10 : r.n === 10, r.n);
}

// Beweglichkeit: Posen durchprobieren
for (const fig of figuren) {
  const r = await pg.evaluate(fig => {
    const posen = [[0, 0], [90, 45], [-90, -45], [45, 30], [-60, 20]], res = [];
    for (const [a, bw] of posen) {
      Object.assign(_mcfP, _MCF_DEF, { figur: fig, farbig: 0, anordnung: 'figur', armW: a, beinW: bw });
      const T = _mcfT.teileMf(_mcfBuild(_mfWasm, _mcfP, 'vorschau'));
      const paare = [['torso', 'armR'], ['torso', 'armL'], ['torso', 'legR'], ['torso', 'legL'], ['legR', 'legL'], ['head', 'torso'],
                     ['head', 'armR'], ['armR', 'legR'], ['armL', 'legL'],
                     ['pinA1', 'torso'], ['pinA1', 'armR'], ['pinA2', 'armL'], ['pinH', 'torso'], ['pinH', 'legR'], ['pinH', 'legL'], ['pinN', 'torso'], ['pinN', 'head']];
      let worst = 0, wo = '';
      for (const [x, y] of paare) { const v = _mcfT.schnitt(T[x], T[y]); if (v > worst) { worst = v; wo = x + '∩' + y; } }
      for (const m of Object.values(T)) m.delete();
      res.push({ pose: [a, bw], worst: +worst.toFixed(3), wo });
    }
    return res;
  }, fig);
  const w = r.reduce((m, x) => x.worst > m.worst ? x : m, { worst: 0 });
  ok(fig + ': in allen Posen frei (Arme ±90°, Beine ±45°), Stifte passen', w.worst < 0.05, w);
}

// Druckplatte
for (const fig of figuren) {
  const r = await pg.evaluate(fig => {
    Object.assign(_mcfP, _MCF_DEF, { figur: fig, farbig: 1, anordnung: 'druck' });
    const res = _mcfBuild(_mfWasm, _mcfP, 'fein');
    let ueber = 0, wo = new Set(), yMin = 1e9;
    const teilMin = {};
    for (const t of res.teile) {
      const pos = t.geo.toNonIndexed().attributes.position.array;
      for (let i = 0; i < pos.length; i += 9) {
        const A = [pos[i], pos[i+1], pos[i+2]], B = [pos[i+3], pos[i+4], pos[i+5]], C = [pos[i+6], pos[i+7], pos[i+8]];
        const ym = Math.min(A[1], B[1], C[1]); yMin = Math.min(yMin, ym);
        teilMin[t.teil] = Math.min(teilMin[t.teil] ?? 1e9, ym);
        const ux = B[0]-A[0], uy = B[1]-A[1], uz = B[2]-A[2], vx = C[0]-A[0], vy = C[1]-A[1], vz = C[2]-A[2];
        const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx, nl = Math.hypot(nx, ny, nz);
        if (nl < 1e-9 || ym < 0.01) continue;
        const c = ny / nl;
        if (c < -0.72 && c > -0.985) { ueber += nl / 2; wo.add(t.teil); }       // schräg überhängend (Brücken = waagerecht, erlaubt)
      }
    }
    const T = _mcfT.teileMf(res), ks = Object.keys(T);
    let ov = 0;
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) ov = Math.max(ov, _mcfT.schnitt(T[ks[i]], T[ks[j]]));
    for (const m of Object.values(T)) m.delete();
    const lose = Object.entries(teilMin).filter(([, v]) => Math.abs(v) > 1e-3).map(([k]) => k);
    return { ueber: +ueber.toFixed(2), wo: [...wo], ov: +ov.toFixed(3), lose, yMin };
  }, fig);
  ok(fig + ' Druckplatte: alle Teile liegen auf', r.lose.length === 0, r.lose);
  ok(fig + ' Druckplatte: Teile überlappen nicht', r.ov < 0.01, r.ov);
  ok(fig + ' Druckplatte: keine schrägen Überhänge', r.ueber < 1, r);
}

const ui = await pg.evaluate(async () => {
  Object.assign(_mcfP, _MCF_DEF);
  _mcfOpen();
  await new Promise(r => setTimeout(r, 800));
  const info = document.getElementById('mcf-info').textContent;
  const n0 = objects.length;
  await _mcfCreate();
  const neu = objects.slice(n0);
  const o = neu[0]; selectObjs([o]); updateFP();
  const btn = !!document.querySelector('button[onclick="_mcfEdit(getFirst())"]');
  document.querySelector('button[onclick="_mcfEdit(getFirst())"]')?.click();
  await new Promise(r => setTimeout(r, 300));
  const knopf = document.getElementById('mcf-go').textContent;
  _mcfStr('figur', 'enderman'); _mcfSet('farbig', 0);
  await _mcfCreate();
  const nach = objects.filter(x => x.userData.mcfSet && x.userData.mcfSet === objects[objects.length - 1].userData.mcfSet);
  const o3 = await buildObjectFromData(JSON.parse(JSON.stringify(objectToData(nach[0]))));
  const geladen = o3.userData.minecraftParams && o3.userData.minecraftParams.figur === 'enderman';
  scene.remove(o3); if (objects.includes(o3)) objects.splice(objects.indexOf(o3), 1);
  return { info, n: neu.length, btn, knopf, ersetzt: objects.length - n0, nachN: nach.length, nachName: nach[0].userData.name, geladen,
           open: document.getElementById('mcf-modal').classList.contains('show') };
});
ok('Info-Text', /Steve/.test(ui.info) && /10 Teile/.test(ui.info), ui.info);
ok('Erstellen legt Steve mehrfarbig an', ui.n > 10, ui.n);
ok('„Im Generator bearbeiten“ im Eigenschaften-Feld, Knopf heißt Übernehmen', ui.btn && /Übernehmen/.test(ui.knopf), ui);
ok('Übernehmen ersetzt den Satz (Enderman einfarbig = 10 Teile)', ui.ersetzt === 10 && ui.nachN === 10 && /Enderman/.test(ui.nachName) && !ui.open, ui);
ok('Speichern/Laden behält die Einstellungen', ui.geladen);
ok('keine Seitenfehler', pageErrors.length === 0, pageErrors);
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles OK');
process.exit(fails.length ? 1 : 0);
