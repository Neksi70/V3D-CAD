// Test: Klemmbaustein-BAUSATZ (_lgoSplitBricks / _lgoBrickGeo / _lgoBuildKit).
// Anders als der Look-Modus entstehen hier echte, einzeln gedruckte Steine, die
// zusammengesteckt werden. Geprüft wird das, woran ein Bausatz scheitert:
//   (1) Maße nach Norm (8·n − 0,2 mm) und Steine sind hohl, nicht massiv,
//   (2) die Klemmung: Noppe des unteren Steins passt MIT dem eingestellten
//       Spiel in den oberen — die Wandstärke ist dafür keine freie Größe,
//   (3) die Zerlegung deckt jede Zelle genau einmal ab,
//   (4) der Mauerverband: Stoßfugen dürfen nicht übereinanderliegen, sonst
//       reißt das Modell genau dort auf,
//   (5) Stückliste und Bauanleitung stimmen mit den Steinen überein.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
try {
  const sess = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('kit-test','test@lokal'))"],
                            { cwd: process.cwd(), encoding: 'utf8' }).trim();
  await ctx.addCookies([{ name: 'v3dsess', value: sess, domain: new global.URL(URL).hostname,
                          path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
} catch (e) { console.log('  (kein Sitzungs-Cookie: ' + e.message.split('\n')[0] + ')'); }
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 90000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show');
                          document.getElementById('auth-overlay')?.classList.add('hidden'); });

// Kantenbilanz + Volumen eines Netzes (wie im Look-Test)
await pg.evaluate(() => {
  window._kitAudit = (pos) => {
    const n = pos.length / 9, q = 1e4, vid = new Map(), ids = new Int32Array(n * 3);
    for (let i = 0; i < n * 3; i++) {
      const k = Math.round(pos[i*3]*q) + '|' + Math.round(pos[i*3+1]*q) + '|' + Math.round(pos[i*3+2]*q);
      let id = vid.get(k); if (id === undefined) { id = vid.size; vid.set(k, id); }
      ids[i] = id;
    }
    const seen = new Set(); let dup = 0;
    for (let t = 0; t < n; t++) for (let e = 0; e < 3; e++) {
      const k = ids[t*3+e] + '>' + ids[t*3+(e+1)%3];
      if (seen.has(k)) dup++; else seen.add(k);
    }
    let open = 0;
    for (const k of seen) { const p = k.split('>'); if (!seen.has(p[1] + '>' + p[0])) open++; }
    let vol = 0;
    for (let t = 0; t < n; t++) { const i = t*9;
      vol += pos[i]*(pos[i+4]*pos[i+8]-pos[i+5]*pos[i+7]) - pos[i+1]*(pos[i+3]*pos[i+8]-pos[i+5]*pos[i+6]) + pos[i+2]*(pos[i+3]*pos[i+7]-pos[i+4]*pos[i+6]); }
    return { tris: n, dup, open, vol: vol/6 };
  };
});

// ── 1) Steinmaße und Hohlkörper ────────────────────────────────────────────
const steine = await pg.evaluate(async () => {
  const R = {};
  for (const [w, d, hz] of [[2,4,9.6],[2,2,9.6],[1,4,9.6],[1,1,9.6],[1,2,3.2]]) {
    const geo = await _lgoBrickGeo(w, d, hz, { clear: 0.2 });
    const pos = geo.attributes.position.array;
    const bb = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
    const sz = bb.getSize(new THREE.Vector3());
    const a = _kitAudit(pos);
    R[w + '×' + d + '@' + hz] = {
      masse: [+sz.x.toFixed(2), +sz.y.toFixed(2), +sz.z.toFixed(2)],
      soll:  [+(w*8-0.2).toFixed(2), +(d*8-0.2).toFixed(2), +(hz+1.8).toFixed(2)],
      zBoden: +bb.min.z.toFixed(3),
      dup: a.dup, open: a.open, vol: +a.vol.toFixed(1),
      massiv: +(sz.x * sz.y * hz).toFixed(1), tris: a.tris
    };
  }
  return R;
});
for (const [name, r] of Object.entries(steine)) {
  ok(name + ': Außenmaß nach Norm (8·n − 0,2)',
     r.masse.every((v, i) => Math.abs(v - r.soll[i]) < 0.01), { ist: r.masse, soll: r.soll });
  ok(name + ': geschlossen + mannigfaltig', r.dup === 0 && r.open === 0, [r.dup, r.open]);
  ok(name + ': steht auf z = 0', Math.abs(r.zBoden) < 1e-6, r.zBoden);
  ok(name + ': ist hohl (unter 80 % Vollmaterial)', r.vol < r.massiv * 0.8, { vol: r.vol, massiv: r.massiv });
}

// ── 2) Klemmung: Spalt = eingestelltes Spiel, Wandstärke abgeleitet ─────────
const passung = await pg.evaluate(async () => {
  const R = [];
  for (const clear of [0.1, 0.2, 0.4]) {
    const wall = _lgoWallFor(clear), P = _LGO.pitch, sr = _LGO.studD/2 - clear/2;
    for (const [w, d] of [[2,4],[2,2],[1,4],[1,1]]) {
      await _lgoBrickGeo(w, d, 9.6, { clear });     // stellt sicher, dass die Sorte baubar ist
      let engste = Infinity;
      for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) {
        const sx = (a-(w-1)/2)*P, sy = (b-(d-1)/2)*P;
        engste = Math.min(engste, (w*8-0.2)/2 - wall - (Math.abs(sx) + sr));
        engste = Math.min(engste, (d*8-0.2)/2 - wall - (Math.abs(sy) + sr));
        if (w >= 2 && d >= 2) {
          const rA = 6.51/2 - clear/2;
          for (let u = 0; u < w-1; u++) for (let v = 0; v < d-1; v++)
            engste = Math.min(engste, Math.hypot(sx - (u-(w-2)/2)*P, sy - (v-(d-2)/2)*P) - sr - rA);
        }
      }
      R.push({ stein: w+'×'+d, clear, wall: +wall.toFixed(2), spalt: +engste.toFixed(3) });
    }
  }
  return R;
});
ok('Klemmspalt entspricht überall genau dem eingestellten Spiel',
   passung.every(r => Math.abs(r.spalt - r.clear) < 0.005),
   passung.filter(r => Math.abs(r.spalt - r.clear) >= 0.005).slice(0, 3));
ok('Wandstärke folgt dem Spiel (1,5 − Spiel/2)',
   passung.every(r => Math.abs(r.wall - (1.5 - r.clear/2)) < 1e-6));
ok('kein Spalt wird negativ (Noppe passt immer hinein)', passung.every(r => r.spalt > 0),
   passung.filter(r => r.spalt <= 0));

// ── 3) Röhrchen nur bei 2×n, nicht bei 1×n ─────────────────────────────────
const rohre = await pg.evaluate(async () => {
  const zaehl = async (w, d) => {
    const geo = await _lgoBrickGeo(w, d, 9.6, { clear: 0.2 });
    const p = geo.attributes.position.array;
    // Röhrchen erkennen: Punkte im Hohlraum (z zwischen 0 und 1), die WEIT von
    // jeder Außenwand entfernt sind, gibt es nur an den Röhrchen.
    const bx = (w*8-0.2)/2, by = (d*8-0.2)/2, wall = _lgoWallFor(0.2);
    const mitten = new Set();
    for (let i = 0; i < p.length; i += 3) {
      if (p[i+2] > 1.0) continue;
      if (Math.abs(Math.abs(p[i]) - bx) < 0.01 || Math.abs(Math.abs(p[i+1]) - by) < 0.01) continue;
      if (Math.abs(Math.abs(p[i]) - (bx - wall)) < 0.01 || Math.abs(Math.abs(p[i+1]) - (by - wall)) < 0.01) continue;
      mitten.add(Math.round(p[i]/8) + ',' + Math.round(p[i+1]/8));
    }
    return mitten.size;
  };
  return { '2x4': await zaehl(2,4), '2x2': await zaehl(2,2), '1x4': await zaehl(1,4), '1x1': await zaehl(1,1) };
});
ok('2×4 hat 3 Röhrchen', rohre['2x4'] === 3, rohre);
ok('2×2 hat 1 Röhrchen', rohre['2x2'] === 1, rohre);
ok('1×n und 1×1 haben keine Röhrchen', rohre['1x4'] === 0 && rohre['1x1'] === 0, rohre);

// ── 4) Zerlegung: jede Zelle genau einmal, nur erlaubte Größen ──────────────
const zerlegung = await pg.evaluate(() => {
  const R = [];
  const erlaubt = new Set(_LGO_SIZES.map(([a,c]) => a+'x'+c).concat(_LGO_SIZES.map(([a,c]) => c+'x'+a)));
  for (const [nx, ny, nz, loch] of [[8,8,4,false],[10,7,3,true],[5,5,5,false]]) {
    const filled = new Uint8Array(nx*ny*nz).fill(1);
    if (loch) for (let k = 0; k < nz; k++) filled[(k*ny+3)*nx+4] = 0;   // Loch quer durch
    for (const stagger of [false, true]) {
      const bricks = _lgoSplitBricks(filled, nx, ny, nz, 8, stagger);
      const deckung = new Int32Array(nx*ny*nz);
      let ungueltig = 0, zuLang = 0;
      for (const b of bricks) {
        if (!erlaubt.has(b.w+'x'+b.d)) ungueltig++;
        if (Math.max(b.w, b.d) > 8) zuLang++;
        for (let q = 0; q < b.d; q++) for (let p = 0; p < b.w; p++)
          deckung[(b.k*ny + b.j+q)*nx + b.i+p]++;
      }
      let fehlt = 0, doppelt = 0, ausserhalb = 0;
      for (let i = 0; i < deckung.length; i++) {
        if (filled[i] && deckung[i] === 0) fehlt++;
        if (deckung[i] > 1) doppelt++;
        if (!filled[i] && deckung[i] > 0) ausserhalb++;
      }
      R.push({ fall: nx+'×'+ny+'×'+nz + (loch?' mit Loch':''), stagger,
               steine: bricks.length, fehlt, doppelt, ausserhalb, ungueltig, zuLang });
    }
  }
  return R;
});
ok('Zerlegung lässt keine Zelle offen', zerlegung.every(r => r.fehlt === 0), zerlegung.filter(r => r.fehlt));
ok('Zerlegung überlappt nirgends', zerlegung.every(r => r.doppelt === 0), zerlegung.filter(r => r.doppelt));
ok('Zerlegung greift nicht ins Leere', zerlegung.every(r => r.ausserhalb === 0), zerlegung.filter(r => r.ausserhalb));
ok('nur Steingrößen aus dem Sortiment', zerlegung.every(r => r.ungueltig === 0), zerlegung.filter(r => r.ungueltig));

// ── 5) Maximale Steinlänge wird eingehalten ────────────────────────────────
const maxlen = await pg.evaluate(() => {
  const nx = 12, ny = 12, nz = 2, filled = new Uint8Array(nx*ny*nz).fill(1);
  const R = {};
  for (const m of [2, 4, 8]) {
    const bricks = _lgoSplitBricks(filled, nx, ny, nz, m, true);
    R['max' + m] = Math.max(...bricks.map(b => Math.max(b.w, b.d)));
  }
  return R;
});
ok('„Längster Stein" wird eingehalten',
   maxlen.max2 <= 2 && maxlen.max4 <= 4 && maxlen.max8 <= 8, maxlen);

// ── 6) Mauerverband ────────────────────────────────────────────────────────
const verband = await pg.evaluate(() => {
  const R = [];
  for (const [nx, ny, nz] of [[8,8,6],[12,6,6],[10,10,5]]) {
    const filled = new Uint8Array(nx*ny*nz).fill(1);
    for (const stagger of [false, true]) {
      const bricks = _lgoSplitBricks(filled, nx, ny, nz, 8, stagger);
      let gemeinsam = 0, gesamt = 0;
      for (let k = 0; k + 1 < nz; k++) {
        const A = _lgoSeams(bricks.filter(x => x.k === k), nx, ny);
        const B = _lgoSeams(bricks.filter(x => x.k === k+1), nx, ny);
        for (const f of A) { gesamt++; if (B.has(f)) gemeinsam++; }
      }
      R.push({ raster: nx+'×'+ny+'×'+nz, stagger, anteil: +(100*gemeinsam/gesamt).toFixed(1) });
    }
  }
  return R;
});
ok('ohne Verband liegen die Fugen übereinander (Ausgangslage)',
   verband.filter(r => !r.stagger).every(r => r.anteil > 90), verband.filter(r => !r.stagger));
ok('mit Verband bleiben unter 10 % gemeinsame Fugen',
   verband.filter(r => r.stagger).every(r => r.anteil < 10), verband.filter(r => r.stagger));

// ── 7) Stückliste ──────────────────────────────────────────────────────────
const liste = await pg.evaluate(() => {
  const nx = 9, ny = 7, nz = 4, filled = new Uint8Array(nx*ny*nz).fill(1);
  const bricks = _lgoSplitBricks(filled, nx, ny, nz, 8, true);
  const l = _lgoStueckliste(bricks);
  return { summe: l.reduce((n, z) => n + z.anzahl, 0), steine: bricks.length,
           sorten: l.length, erste: l[0], sortiert: l.every((z, i) => i === 0 || l[i-1].flaeche >= z.flaeche) };
});
ok('Stückliste zählt alle Steine', liste.summe === liste.steine, liste);
ok('Stückliste ist nach Größe sortiert', liste.sortiert, liste.erste);

// ── 8) Bauanleitung ────────────────────────────────────────────────────────
const anleitung = await pg.evaluate(() => {
  const nx = 6, ny = 6, nz = 3, filled = new Uint8Array(nx*ny*nz).fill(1);
  const bricks = _lgoSplitBricks(filled, nx, ny, nz, 8, true);
  const html = _lgoGuideHtml(bricks, nx, ny, nz, 9.6, 'Testkörper <script>');
  return { laenge: html.length, schichten: (html.match(/<section>/g) || []).length,
           hatListe: html.includes('Stückliste'), hatSvg: (html.match(/<svg /g) || []).length,
           steinzahl: html.includes('' + bricks.length + ' Steine'),
           escaped: !html.includes('<script>') };
});
ok('Bauanleitung hat eine Seite je Schicht', anleitung.schichten === 3 && anleitung.hatSvg === 3, anleitung);
ok('Bauanleitung enthält die Stückliste', anleitung.hatListe && anleitung.steinzahl, anleitung);
ok('Bauanleitung maskiert den Modellnamen (kein HTML-Einschleusen)', anleitung.escaped);

// ── 9) Ganzer Weg über die Oberfläche ──────────────────────────────────────
for (const out of ['built', 'plate']) {
  const r = await pg.evaluate(async (out) => {
    if (objects.length) { selectObjs(objects.slice()); deleteSelected(); }
    addShape('sphere'); const o = objects[objects.length-1];
    selectObjs([o]); _lgoOpen(); _lgoSetMode('kit'); _lgoSetOut(out);
    document.getElementById('lgo-studs').value = 8;
    document.getElementById('lgo-guide').checked = false;
    _lgoInfo();
    const vorher = objects.length;
    await _lgoCreate();
    for (let i = 0; i < 300 && objects.length === vorher; i++) await new Promise(r => setTimeout(r, 50));
    const neu = objects.filter(x => x !== o);
    const bb = new THREE.Box3(); neu.forEach(n => bb.expandByObject(n));
    const sz = bb.getSize(new THREE.Vector3()).multiplyScalar(10);
    let tris = 0, dup = 0, open = 0;
    for (const n of neu) { const a = _kitAudit(n.geometry.attributes.position.array); tris += a.tris; dup += a.dup; open += a.open; }
    return { gruppen: neu.length, namen: neu.map(n => n.userData.name.replace(/^.*?— /, '')),
             masse: sz.toArray().map(v => Math.round(v)), tris, dup, open,
             originalVersteckt: !o.visible, ausgewaehlt: selectedObjs.length };
  }, out);
  ok(out + ': Gruppen entstanden', r.gruppen > 1, { gruppen: r.gruppen, namen: r.namen.slice(0, 3) });
  ok(out + ': jede Gruppe ist ein geschlossenes Netz', r.open === 0, { dup: r.dup, open: r.open });
  ok(out + ': Ergebnis ist ausgewählt', r.ausgewaehlt === r.gruppen, r.ausgewaehlt);
  if (out === 'built') {
    ok('built: Modell hat die Rastergröße (8 Noppen = 64 mm)',
       Math.abs(r.masse[0] - 64) <= 1, r.masse);
    ok('built: Gruppen heißen nach Schichten', r.namen.every(n => /^Schicht \d+/.test(n)), r.namen.slice(0, 2));
    ok('built: Original ist ausgeblendet', r.originalVersteckt);
  } else {
    ok('plate: Gruppen heißen nach Steinsorte', r.namen.every(n => /^\d+×\d+ — \d+ Stück$/.test(n)), r.namen.slice(0, 3));
    ok('plate: Anordnung bleibt in der Plattenbreite',
       r.masse[0] <= 800, r.masse);
    ok('plate: Original bleibt sichtbar', !r.originalVersteckt);
  }
}

// ── 10) Notbremse bei zu vielen Steinen ────────────────────────────────────
const bremse = await pg.evaluate(() => {
  const nx = 40, ny = 40, nz = 30, filled = new Uint8Array(nx*ny*nz).fill(1);
  return _lgoSplitBricks(filled, nx, ny, nz, 8, true).length;
});
ok('großes Modell überschreitet die 2500er-Grenze (Notbremse greift)', bremse > 2500, bremse);

ok('keine JS-Fehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\nFEHLGESCHLAGEN: ' + fails.join(', ') : '\nAlle Bausatz-Tests bestanden.');
process.exit(fails.length ? 1 : 0);
