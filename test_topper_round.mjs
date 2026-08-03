// Test für die Kantenrundung im Tortentopper (_ttExtrude/_ttSafeNorms):
// wasserdicht? Gesamtdicke erhalten? Unterseite flach, wenn nur oben gerundet?
// Und: greift die Engstellen-Bremse an haarfeinen Schreibschrift-Strichen?
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8796;
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
  if (typeof _ttExtrude !== 'function') return { err: '_ttExtrude fehlt' };

  // ── Werkzeuge ──────────────────────────────────────────────────────────────
  const key = (p, i) => Math.round(p[i*3]*1e4)+'_'+Math.round(p[i*3+1]*1e4)+'_'+Math.round(p[i*3+2]*1e4);
  const topo = geo => {                      // offene/nicht-manifolde Kanten zählen
    const p = geo.attributes.position.array, idx = geo.index ? geo.index.array : null;
    const nTri = idx ? idx.length/3 : p.length/9;
    const em = new Map();
    for (let t=0;t<nTri;t++){
      const v = [0,1,2].map(k => key(p, idx ? idx[t*3+k] : t*3+k));
      for (let k=0;k<3;k++){
        const a=v[k], b=v[(k+1)%3];
        if (a===b) continue;                 // entartetes Dreieck ignorieren
        em.set(a<b ? a+'|'+b : b+'|'+a, (em.get(a<b?a+'|'+b:b+'|'+a)||0)+1);
      }
    }
    let open=0, nonman=0;
    for (const c of em.values()){ if (c===1) open++; else if (c>2) nonman++; }
    return { open, nonman, nTri };
  };
  const vol = geo => {                       // vorzeichenbehaftetes Volumen (Einheiten³)
    const p = geo.attributes.position.array, idx = geo.index ? geo.index.array : null;
    const nTri = idx ? idx.length/3 : p.length/9;
    let V = 0;
    for (let t=0;t<nTri;t++){
      const i0=idx?idx[t*3]:t*3, i1=idx?idx[t*3+1]:t*3+1, i2=idx?idx[t*3+2]:t*3+2;
      const ax=p[i0*3],ay=p[i0*3+1],az=p[i0*3+2], bx=p[i1*3],by=p[i1*3+1],bz=p[i1*3+2], cx=p[i2*3],cy=p[i2*3+1],cz=p[i2*3+2];
      V += (ax*(by*cz-bz*cy) - ay*(bx*cz-bz*cx) + az*(bx*cy-by*cx))/6;
    }
    return V;
  };
  const bbox = geo => { geo.computeBoundingBox(); const b=geo.boundingBox;
    return { x:[+b.min.x.toFixed(4), +b.max.x.toFixed(4)], y:[+b.min.y.toFixed(4), +b.max.y.toFixed(4)], z:[+b.min.z.toFixed(4), +b.max.z.toFixed(4)] }; };
  // Fläche der Dreiecke, die exakt auf z=zv liegen (Deckel-/Bodenfläche)
  const capArea = (geo, zv) => {
    const p = geo.attributes.position.array, idx = geo.index ? geo.index.array : null;
    const nTri = idx ? idx.length/3 : p.length/9;
    let A = 0;
    for (let t=0;t<nTri;t++){
      const i=[0,1,2].map(k=> idx?idx[t*3+k]:t*3+k);
      if (!i.every(v => Math.abs(p[v*3+2]-zv) < 1e-4)) continue;
      const ax=p[i[0]*3],ay=p[i[0]*3+1], bx=p[i[1]*3],by=p[i[1]*3+1], cx=p[i[2]*3],cy=p[i[2]*3+1];
      A += Math.abs((bx-ax)*(cy-ay)-(cx-ax)*(by-ay))/2;
    }
    return A;
  };

  // ── 1) Quadrat 20×20 mm, 3 mm dick, 0,4 mm Rundung nur oben ────────────────
  const sq = s => { const h=new THREE.Shape(); h.moveTo(-s,-s); h.lineTo(s,-s); h.lineTo(s,s); h.lineTo(-s,s); h.closePath(); return h; };
  const thick = 0.3, r = 0.04;                       // Units: 3 mm / 0,4 mm
  const gPlain = _ttExtrude(sq(1), thick, 0, false, 12, {min:Infinity});
  const st1 = {min:Infinity};
  const gTop  = _ttExtrude(sq(1), thick, r, false, 12, st1);
  out.plain = { ...topo(gPlain), vol:+vol(gPlain).toFixed(5), bb:bbox(gPlain) };
  out.top   = { ...topo(gTop),   vol:+vol(gTop).toFixed(5),   bb:bbox(gTop), bev:+(st1.min*10).toFixed(3) };
  out.topBottomArea = +capArea(gTop, 0).toFixed(4);        // flach: volle 4,0 Units²
  out.topTopArea    = +capArea(gTop, thick).toFixed(4);    // eingezogen: (2-2r)²

  // ── 2) beidseitig gerundet ────────────────────────────────────────────────
  const st2 = {min:Infinity};
  const gBoth = _ttExtrude(sq(1), thick, r, true, 12, st2);
  out.both = { ...topo(gBoth), vol:+vol(gBoth).toFixed(5), bb:bbox(gBoth), bev:+(st2.min*10).toFixed(3) };
  out.bothBottomArea = +capArea(gBoth, 0).toFixed(4);

  // ── 3) Engstellen-Bremse: 0,6 mm schmaler Streifen, 0,4 mm gewünscht ──────
  const strip = new THREE.Shape();
  strip.moveTo(-1,-0.03); strip.lineTo(1,-0.03); strip.lineTo(1,0.03); strip.lineTo(-1,0.03); strip.closePath();
  const st3 = {min:Infinity};
  const gThin = _ttExtrude(strip, thick, r, false, 12, st3);
  out.thin = { ...topo(gThin), vol:+vol(gThin).toFixed(5), bevMM:+(st3.min*10).toFixed(3),
    // Deckel muss übrig bleiben (0,6 mm breiter Strich, 0,4 mm Wunschradius →
    // Versatz zieht sich auf ≤0,27 mm zurück, statt den Strich zuzuschnüren)
    topArea:+capArea(gThin, thick).toFixed(4), botArea:+capArea(gThin, 0).toFixed(4) };

  // ── 4) Loch-Kontur (Buchstabe „o"): Ring bleibt Ring ──────────────────────
  const ring = sq(1);
  ring.holes.push(new THREE.Path([[-0.4,-0.4],[-0.4,0.4],[0.4,0.4],[0.4,-0.4]].map(p=>new THREE.Vector2(p[0],p[1]))));
  const st4 = {min:Infinity};
  const gRing = _ttExtrude(ring, thick, r, false, 12, st4);
  out.ring = { ...topo(gRing), vol:+vol(gRing).toFixed(5), bevMM:+(st4.min*10).toFixed(3) };

  // ── 5) Echter Topper in Schreibschrift, mit und ohne Rundung ─────────────
  document.getElementById('tt-text').value = 'Denise & Sebastian';
  document.getElementById('tt-dheart').checked = false;
  document.getElementById('tt-thick').value = 3;
  document.getElementById('tt-pins').value = 1;
  const run = (roundMM, both, fontKey) => new Promise(res2 => {
    document.getElementById('tt-round').value = roundMM;
    document.getElementById('tt-round2').checked = both;
    if (fontKey) document.getElementById('tt-font').value = fontKey;
    const o = _ttOpts();
    _ttWithFonts(o, font => {
      let r2 = null, err = null;
      try { r2 = _ttGeo(font, o, true); } catch(e){ err = String(e); }
      if (!r2) return res2({ err: err || 'kein Ergebnis' });
      const t = r2.pieces.map(p => topo(p.geo));
      res2({
        roundMM: +(r2.roundMM||0).toFixed(3),
        pieces: r2.pieces.length, bridges: r2.nBridges,
        wMM: +r2.wMM.toFixed(1), hMM: +r2.hMM.toFixed(1),
        tris: t.reduce((s,x)=>s+x.nTri,0),
        open: t.reduce((s,x)=>s+x.open,0), nonman: t.reduce((s,x)=>s+x.nonman,0),
        bridgesOpen: r2.bridgeGeos.reduce((s,g)=>s+topo(g).open,0),
        pins: r2.pinGeos.length,
        vol: +r2.pieces.reduce((s,p)=>s+vol(p.geo),0).toFixed(4),
        yRange: r2.pieces.map(p => { p.geo.computeBoundingBox();
          return [+p.geo.boundingBox.min.y.toFixed(4), +p.geo.boundingBox.max.y.toFixed(4)]; })[0],
        err
      });
    });
  });
  out.font = document.getElementById('tt-font').value;
  out.ttSharp  = await run(0,   false);   // Schreibschrift (Vorgabe des Generators)
  out.ttRound  = await run(0.4, false);
  out.ttRound2 = await run(0.4, true);
  // Zweite Schrift zum Gegenprüfen: Blockschrift mit ganz anderen Konturen
  // (viele Ecken, kaum dünne Stellen) — dort MUSS der Volumenverlust klein sein.
  out.hvSharp  = await run(0,   false, 'helvetiker_bold');
  out.hvRound  = await run(0.4, false, 'helvetiker_bold');
  out.hvRound2 = await run(0.4, true,  'helvetiker_bold');
  return out;
});

console.log(JSON.stringify(res, null, 1));
console.log('pageerrors:', errs);

// ── Auswertung ──────────────────────────────────────────────────────────────
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
if (res.err) fails.push(res.err);
else {
  ok(res.top.open === 0 && res.top.nonman === 0, 'Rundung oben nicht wasserdicht: ' + JSON.stringify(res.top));
  ok(res.both.open === 0 && res.both.nonman === 0, 'Rundung beidseitig nicht wasserdicht: ' + JSON.stringify(res.both));
  ok(res.thin.open === 0 && res.thin.nonman === 0, 'Schmaler Streifen nicht wasserdicht: ' + JSON.stringify(res.thin));
  ok(res.ring.open === 0 && res.ring.nonman === 0, 'Ring nicht wasserdicht: ' + JSON.stringify(res.ring));
  // Sollwerte: Prisma minus Rundungs-Zwickel = Umfang · r² · (1 − π/4) je Kante.
  // (Mit 4 Stufen ist der Viertelkreis ein einbeschriebenes Vieleck, es fehlt also
  // etwas mehr Material als beim echten Radius → ~10 % Toleranz auf den Zwickel.)
  const nick = 8 * 0.04**2 * (1 - Math.PI/4);
  ok(Math.abs(res.plain.vol - 1.2) < 1e-4, 'Grundvolumen falsch: ' + res.plain.vol);
  ok(Math.abs(res.top.vol  - (1.2 - nick))   < nick*0.12, 'Volumen oben-gerundet: ' + res.top.vol + ' statt ' + (1.2-nick).toFixed(5));
  ok(Math.abs(res.both.vol - (1.2 - 2*nick)) < 2*nick*0.12, 'Volumen beidseitig: ' + res.both.vol + ' statt ' + (1.2-2*nick).toFixed(5));
  // Ring 2×2 mit Loch 0,8×0,8: (4 − 0,64) · 0,3 minus Zwickel an 11,2 Umfang
  ok(Math.abs(res.ring.vol - (3.36*0.3 - 11.2*0.04**2*(1-Math.PI/4))) < 5e-3, 'Ring-Volumen: ' + res.ring.vol);
  ok(Math.abs(res.top.bb.z[1] - 0.3) < 1e-3 && Math.abs(res.top.bb.z[0]) < 1e-3, 'Dicke verändert: ' + JSON.stringify(res.top.bb));
  ok(Math.abs(res.top.bb.x[0] + 1) < 1e-3 && Math.abs(res.top.bb.x[1] - 1) < 1e-3, 'Umriss geschrumpft: ' + JSON.stringify(res.top.bb));
  ok(Math.abs(res.topBottomArea - 4) < 1e-2, 'Unterseite nicht flach/voll (soll 4,0): ' + res.topBottomArea);
  ok(Math.abs(res.topTopArea - (2-2*0.04)**2) < 1e-2, 'Deckel nicht um Radius eingezogen: ' + res.topTopArea);
  ok(Math.abs(res.bothBottomArea - (2-2*0.04)**2) < 1e-2, 'Unterseite bei beidseitig nicht eingezogen: ' + res.bothBottomArea);
  ok(res.thin.botArea > 0.11 && res.thin.topArea > 0.02,
     'Engstellen-Bremse: 0,6-mm-Streifen schnürt zu (Deckel ' + res.thin.topArea + ', Boden ' + res.thin.botArea + ')');
  ok(res.ttRound.roundMM > 0.35, 'Topper-Rundung nicht angekommen: ' + JSON.stringify(res.ttRound));
  ok(!res.ttRound.err && !res.ttRound2.err && !res.ttSharp.err, 'Topper-Bau fehlgeschlagen');
  ok(Math.abs(res.ttRound.wMM - res.ttSharp.wMM) < 1.5, 'Topper-Breite springt durch die Rundung');
  ok(res.ttRound.bridges === res.ttSharp.bridges, 'Stege ändern sich durch die Rundung');
  for (const [n, sharp, r1, r2] of [['Schreibschrift', res.ttSharp, res.ttRound, res.ttRound2],
                                    ['Blockschrift',   res.hvSharp, res.hvRound, res.hvRound2]]){
    // Runden nimmt Material weg — nie welches dazu (das täte es nur, wenn sich die
    // eingezogene Kontur überschlägt und die Falte als Material zählt).
    ok(r1.vol < sharp.vol && r1.vol > sharp.vol*0.9,
       n + ': Volumen unplausibel — scharf ' + sharp.vol + ' vs. gerundet ' + r1.vol);
    ok(r2.vol < r1.vol && r2.vol > sharp.vol*0.85,
       n + ': beidseitig gerundet muss zwischen einseitig und −15 % liegen (' + r2.vol + ')');
  }
  ok(res.hvRound.roundMM > 0.35 && !res.hvRound.err, 'Blockschrift-Rundung fehlt: ' + JSON.stringify(res.hvRound));
  for (const [n, v] of Object.entries({ttRound:res.ttRound, ttRound2:res.ttRound2, hvRound:res.hvRound, hvRound2:res.hvRound2})){
    ok(v.open === 0 && v.nonman === 0, n + ': Schriftzug nicht wasserdicht (offen ' + v.open + ', non-manifold ' + v.nonman + ')');
    ok(v.bridgesOpen === 0, n + ': Stege nicht wasserdicht');
    ok(v.pins === 1, n + ': Pin fehlt');
  }
  ok(Math.abs(res.ttRound.yRange[0]) < 1e-3, 'Topper liegt nicht mehr auf y=0: ' + res.ttRound.yRange);
  ok(errs.length === 0, 'Page-Errors: ' + errs.join(' | '));
}

console.log(fails.length ? '❌ FAIL\n' + fails.map(f=>' - '+f).join('\n') : '✅ alle Prüfungen bestanden');
await browser.close();
srv.kill();
process.exit(fails.length ? 1 : 0);
