// Headless-Check des Organic-Planter-Generators gegen den --dev-Server (Port 8766).
// Prüft: baubar, wasserdicht (keine offenen/nicht-manifolden Kanten), Winding
// korrekt (positives Volumen), Wandstärke, Abfluss-Schlitze wirklich offen.
import { chromium } from 'playwright';

const url = 'http://127.0.0.1:8766/volme3d.html';
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('  [browser error]', m.text()); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window._oplBuildBody === 'function', null, { timeout: 30000 });

const analyze = (geo) => {};   // im Browser definiert

const res = await page.evaluate(() => {
  function check(geo) {
    const p = geo.attributes.position, ix = geo.index;
    const tri = ix.count / 3;
    // Kanten-Bilanz auf verschweißten Positionen (Vertices sind bereits geteilt)
    const edges = new Map();
    let vol = 0;
    const ax = [0,0,0], bx = [0,0,0], cx = [0,0,0];
    for (let t = 0; t < tri; t++) {
      const a = ix.getX(t*3), b = ix.getX(t*3+1), c = ix.getX(t*3+2);
      for (const [u, v] of [[a,b],[b,c],[c,a]]) {
        const k = u < v ? u + ':' + v : v + ':' + u;
        const e = edges.get(k) || { n: 0, dir: 0 };
        e.n++; e.dir += (u < v ? 1 : -1);
        edges.set(k, e);
      }
      ax[0]=p.getX(a); ax[1]=p.getY(a); ax[2]=p.getZ(a);
      bx[0]=p.getX(b); bx[1]=p.getY(b); bx[2]=p.getZ(b);
      cx[0]=p.getX(c); cx[1]=p.getY(c); cx[2]=p.getZ(c);
      vol += (ax[0]*(bx[1]*cx[2]-bx[2]*cx[1]) - ax[1]*(bx[0]*cx[2]-bx[2]*cx[0]) + ax[2]*(bx[0]*cx[1]-bx[1]*cx[0])) / 6;
    }
    let open = 0, nonMani = 0, badDir = 0;
    for (const e of edges.values()) {
      if (e.n === 1) open++;
      else if (e.n > 2) nonMani++;
      else if (e.dir !== 0) badDir++;     // beide Dreiecke laufen gleich herum → Normalen kippen
    }
    return { tris: tri, verts: p.count, open, nonMani, badDir, vol };
  }

  const out = {};
  const P = JSON.parse(JSON.stringify(_oplP));

  // 1) Default-Topf
  const cfg = _oplPotCfg(_oplP);
  out.pot = check(_oplBuildBody(cfg, false));

  // 2) Untersetzer
  const sc = _oplSaucerCfg(_oplP, cfg);
  out.saucer = check(_oplBuildBody(sc, false));
  // passt der Topffuß rein?
  let footMax = 0, sauInMin = Infinity;
  for (let s = 0; s < 128; s++) {
    const a = s * Math.PI * 2 / 128;
    footMax = Math.max(footMax, cfg.rOut(a, 0));
    sauInMin = Math.min(sauInMin, sc.rIn(a, 1));
  }
  out.fitGapMm = (sauInMin - footMax) / 0.1;

  // 3) minimale Wandstärke (radial gemessen)
  let wmin = Infinity;
  for (let s = 0; s < 200; s++) for (let i = 1; i <= 40; i++) {
    const a = s * Math.PI * 2 / 200, t = i / 40;
    wmin = Math.min(wmin, cfg.rOut(a, t) - cfg.rIn(a, t));
  }
  out.wallMinMm = wmin / 0.1;
  out.wallSetMm = _oplP.wall;

  // 4) Varianten: ohne Abfluss, ohne Wülste, ohne Struktur, Extremwerte
  const variants = {
    keinAbfluss:  { drain: 0 },
    vieleSchlitze:{ drain: 12, drainW: 80 },
    keineWuelste: { lobes: 0 },
    glatt:        { rough: 0, wobble: 0, lobes: 0, barrel: 0 },
    extrem:       { h: 260, dia: 240, bot: 45, barrel: 20, lobes: 9, lobeAmp: 10, lobeWave: 100, wobble: 10, rough: 1.6, wall: 1.6, floor: 2, drain: 12, drainW: 80 },
    klein:        { h: 45, dia: 50, wall: 6, floor: 10, drain: 3 },
  };
  out.variants = {};
  for (const [name, patch] of Object.entries(variants)) {
    Object.assign(_oplP, P, patch);
    const c2 = _oplPotCfg(_oplP);
    const r = check(_oplBuildBody(c2, false));
    let w = Infinity;
    for (let s = 0; s < 120; s++) for (let i = 1; i <= 30; i++)
      w = Math.min(w, c2.rOut(s*Math.PI*2/120, i/30) - c2.rIn(s*Math.PI*2/120, i/30));
    r.wallMinMm = +(w / 0.1).toFixed(2);
    out.variants[name] = r;
  }
  Object.assign(_oplP, P);

  // 5) Vorschau-Geometrie (Topf + Untersetzer gemergt)
  const pv = _oplPreviewGeo();
  out.preview = { verts: pv.attributes.position.count, tris: pv.index.count / 3 };
  return out;
});

console.log(JSON.stringify(res, null, 2));

let fail = 0;
const chk = (name, r) => {
  const ok = r.open === 0 && r.nonMani === 0 && r.badDir === 0 && r.vol > 0;
  if (!ok) { fail++; console.log('FAIL ' + name, r); }
  else console.log('ok   ' + name + '  tris=' + r.tris + ' vol=' + r.vol.toFixed(3) + (r.wallMinMm !== undefined ? ' wallMin=' + r.wallMinMm + 'mm' : ''));
};
chk('pot', res.pot);
chk('saucer', res.saucer);
for (const [n, r] of Object.entries(res.variants)) chk('variant:' + n, r);
if (res.wallMinMm < res.wallSetMm - 0.01) { fail++; console.log('FAIL Wandstärke', res.wallMinMm, '<', res.wallSetMm); }
else console.log('ok   Wandstärke min ' + res.wallMinMm.toFixed(2) + ' mm (Soll ' + res.wallSetMm + ')');
if (res.fitGapMm < 0.5) { fail++; console.log('FAIL Untersetzer-Spiel', res.fitGapMm); }
else console.log('ok   Untersetzer-Spiel ' + res.fitGapMm.toFixed(2) + ' mm');

await browser.close();
process.exit(fail ? 1 : 0);
