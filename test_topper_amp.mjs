// Test für die &-Auswahl im Tortentopper (_ttSetAmp/_ttAmpText):
// „& der Schrift" | „schlichtes &" | ♥ | „und" — je eigene Geometrie, alles heil.
// Hintergrund: Der Great-Vibes-Schnörkel legt sich quer über beide Namen (Ralf).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PORT = 8761;
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
  if (typeof _ttSetAmp !== 'function') return { err: '_ttSetAmp fehlt' };
  const topo = geo => {
    const p = geo.attributes.position.array, idx = geo.index ? geo.index.array : null;
    const nTri = idx ? idx.length/3 : p.length/9, em = new Map();
    const key = i => Math.round(p[i*3]*1e4)+'_'+Math.round(p[i*3+1]*1e4)+'_'+Math.round(p[i*3+2]*1e4);
    for (let t=0;t<nTri;t++){ const v=[0,1,2].map(k=>key(idx?idx[t*3+k]:t*3+k));
      for (let k=0;k<3;k++){ const a=v[k], b=v[(k+1)%3]; if(a===b) continue;
        const kk=a<b?a+'|'+b:b+'|'+a; em.set(kk,(em.get(kk)||0)+1); } }
    let open=0; for (const c of em.values()) if (c===1) open++;
    return { open, tris:nTri };
  };
  document.getElementById('tt-text').value = 'Denise & Sebastian';
  document.getElementById('tt-font').value = 'greatvibes_local';
  document.getElementById('tt-dheart').checked = false;
  document.getElementById('tt-pins').value = 1;
  document.getElementById('tt-round').value = 0.4;

  const run = amp => new Promise(res2 => {
    _ttSetAmp(amp);
    const o = _ttOpts();
    _ttWithFonts(o, font => {
      let r = null, err = null;
      try { r = _ttGeo(font, o, true); } catch(e){ err = String(e); }
      if (!r) return res2({ err: err || 'kein Ergebnis' });
      const t = r.pieces.map(p => topo(p.geo));
      res2({ amp, text:_ttAmpText(o), wMM:+r.wMM.toFixed(1), bridges:r.nBridges,
             tris:t.reduce((s,x)=>s+x.tris,0), open:t.reduce((s,x)=>s+x.open,0),
             ampFontUsed: !!o.ampFont, err });
    });
  });
  // Das &-Zeichen selbst vermessen: Great Vibes zeichnet eine große Schleife, die
  // sich über die Nachbarn legt (deshalb wird die ZEILE dadurch nicht breiter —
  // genau das ist Ralfs Problem). Das schlichte & muss deutlich kompakter sein.
  out.glyph = await new Promise(res2 => {
    _npLoadFont('greatvibes_local', gv => _npLoadFont('gentilis_bold', ge => {
      const measure = (opt) => {
        const parts = _ttLayoutParts(gv, 'A & B', 3, 0.08, 3, opt);
        let lo = Infinity, hi = -Infinity, up = -Infinity, dn = Infinity;
        for (const p of parts) if (p.label === '&') for (const q of p.pts) {
          if (q.x < lo) lo = q.x; if (q.x > hi) hi = q.x;
          if (q.y > up) up = q.y; if (q.y < dn) dn = q.y;
        }
        return { w:+((hi-lo)*10).toFixed(1), h:+((up-dn)*10).toFixed(1) };
      };
      res2({ script: measure(null), plain: measure({ ampFont: ge }) });
    }));
  });
  out.font   = await run('font');
  out.plain  = await run('plain');
  out.heart  = await run('heart');
  out.und    = await run('und');
  // Zeile darf nur auftauchen, wenn wirklich ein & im Text steht
  _ttPreview(); await new Promise(r=>setTimeout(r,300));
  out.rowShown = document.getElementById('tt-row-amp').style.display !== 'none';
  document.getElementById('tt-text').value = 'Julia';
  _ttPreview(); await new Promise(r=>setTimeout(r,300));
  out.rowHidden = document.getElementById('tt-row-amp').style.display === 'none';
  return out;
});

console.log(JSON.stringify(res, null, 1));
console.log('pageerrors:', errs.slice(0,3));

const fails = [];
const ok = (c,m) => { if(!c) fails.push(m); };
if (res.err) fails.push(res.err);
else {
  for (const k of ['font','plain','heart','und']) {
    const v = res[k];
    ok(v && !v.err, k + ': Bau fehlgeschlagen — ' + (v && v.err));
    ok(v && v.open === 0, k + ': Schriftzug nicht wasserdicht (' + (v||{}).open + ' offene Kanten)');
    ok(v && v.tris > 1000, k + ': verdächtig wenig Geometrie (' + (v||{}).tris + ' Dreiecke)');
  }
  ok(res.plain.ampFontUsed, 'schlichtes &: zweite Schrift wurde nicht geladen');
  ok(!res.font.ampFontUsed, '& der Schrift: es wurde unnötig eine zweite Schrift geladen');
  ok(res.heart.text.includes('♥') && !res.heart.text.includes('&'), '♥: Text nicht ersetzt — ' + res.heart.text);
  ok(res.und.text === 'Denise und Sebastian', '„und": Text falsch ersetzt — ' + res.und.text);
  ok(res.font.text === 'Denise & Sebastian', '& der Schrift: Text wurde angefasst — ' + res.font.text);
  // Das Zeichen selbst: der Schnörkel ist ein Vielfaches so groß wie ein
  // schlichtes &. (Die ZEILE wird dadurch nicht breiter — die Schleife legt sich
  // ja über die Nachbarn, statt Platz zu brauchen.)
  const G = res.glyph || {};
  ok(G.script && G.plain, '&-Zeichen konnte nicht vermessen werden');
  ok(G.plain.w < G.script.w, 'schlichtes & ist nicht kompakter als der Schnörkel: ' + JSON.stringify(G));
  // Größenabgleich: das Ersatzzeichen ist so hoch wie das & der Hauptschrift,
  // sitzt also genau dort, wo der Schnörkel gesessen hätte.
  ok(Math.abs(G.plain.h - G.script.h) < G.script.h*0.1, 'schlichtes & passt nicht zur Schrift: ' + JSON.stringify(G));
  ok(res.und.wMM > res.plain.wMM, '„und" müsste breiter bauen als ein einzelnes Zeichen');
  ok(res.font.tris !== res.plain.tris, 'schlichtes & liefert dieselbe Geometrie wie der Schnörkel');
  ok(res.rowShown && res.rowHidden, 'Die &-Zeile erscheint nicht passend zum Text (an: ' + res.rowShown + ', aus: ' + res.rowHidden + ')');
  ok(errs.length === 0, 'Page-Errors: ' + errs.join(' | '));
}
console.log(fails.length ? '❌ FAIL\n' + fails.map(f=>' - '+f).join('\n') : '✅ alle Prüfungen bestanden');
await browser.close(); srv.kill();
process.exit(fails.length ? 1 : 0);
