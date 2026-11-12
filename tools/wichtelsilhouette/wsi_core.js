// Wichtel-Silhouetten — Türecke (L-Rahmen) oder Aufsteller. Flach, mm, liegt auf z = 0 (Vorderseite oben).
// Schichten: Grundplatte (ganzer Umriss, etwas größer → sichtbarer Rand), weiße Auflage (Bart, Krempe, Streifen,
// Punkte, Bommel/Stern) und Nase, beide 0,8 mm erhaben auf der Platte (einfarbig über die Höhe lesbar, mit AMS bunt).
function _wsiWichtel(CS, k, x0, h, stil) {
  const P = pts => k(new CS([pts.map(([x, y]) => [x0 + x * h, y * h])], 'NonZero'));
  const rund = (cs, r) => k(k(cs.offset(-r, 'Round', 2, 16)).offset(r, 'Round', 2, 16));
  const kreis = (x, y, r) => k(k(CS.circle(r * h, 32)).translate([x0 + x * h, y * h]));
  const koerper = rund(P([[-0.3, 0.1], [0.3, 0.1], [0.24, 0.5], [-0.24, 0.5]]), 0.04 * h);
  const stiefel = k(CS.union([rund(P([[-0.21, 0], [-0.04, 0], [-0.04, 0.14], [-0.21, 0.14]]), 0.025 * h), rund(P([[0.04, 0], [0.21, 0], [0.21, 0.14], [0.04, 0.14]]), 0.025 * h)]));
  let hutP, spitze;
  if (stil === 'zipfel') { hutP = [[-0.3, 0.52], [-0.22, 0.78], [-0.08, 0.95], [0.12, 1.02], [0.3, 0.97], [0.36, 0.9], [0.24, 0.89], [0.1, 0.86], [0.3, 0.52]]; spitze = [0.37, 0.9]; }
  else { hutP = [[-0.3, 0.52], [0.0, 1.0], [0.3, 0.52]]; spitze = [0.0, 1.0]; }
  const hut = rund(P(hutP), 0.02 * h);
  const krempe = rund(P([[-0.32, 0.46], [0.32, 0.46], [0.32, 0.56], [-0.32, 0.56]]), 0.03 * h);
  const bart = rund(P([[-0.27, 0.5], [0.27, 0.5], [0.26, 0.3], [0.17, 0.15], [0.09, 0.21], [0, 0.07], [-0.09, 0.21], [-0.17, 0.15], [-0.26, 0.3]]), 0.015 * h);
  const nase = kreis(0, 0.46, 0.075);
  const weiss = [krempe, bart];
  if (stil === 'punkte') { for (const [x, y] of [[-0.12, 0.66], [0.1, 0.7], [-0.02, 0.8], [0.06, 0.6], [-0.18, 0.6]]) weiss.push(kreis(x, y, 0.035)); weiss.push(kreis(...spitze, 0.065)); }
  else if (stil === 'zipfel') { for (const y of [0.64, 0.76]) weiss.push(k(k(P([[-0.4, y], [0.4, y], [0.4, y + 0.05], [-0.4, y + 0.05]])).intersect(hut))); weiss.push(kreis(...spitze, 0.065)); }
  else { for (const y of [0.63, 0.75, 0.86]) weiss.push(k(k(P([[-0.4, y], [0.4, y], [0.4, y + 0.045], [-0.4, y + 0.045]])).intersect(hut)));
    const st = []; for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = (i % 2 ? 0.035 : 0.08); st.push([spitze[0] + r * Math.cos(a), spitze[1] + 0.02 + r * Math.sin(a)]); } weiss.push(P(st)); }
  const alles = k(CS.union([koerper, stiefel, hut, krempe, bart, nase, ...weiss]));
  return { alles, weiss: k(CS.union(weiss)), nase };
}
function _wsiBuild(w, p) {
  const M = w.Manifold, CS = w.CrossSection, tmp = [], k = x => { tmp.push(x); return x; };
  try {
    const h = p.hoehe, n = Math.max(1, Math.round(p.anzahl)), ab = 0.58 * h, t = p.dicke, aufl = 0.8, rand = 1.2, hb = p.leiste;
    const stile = ['punkte', 'zipfel', 'streifen'], A = [], W = [], N = [];
    const xStart = p.modus === 'ecke' ? hb + 0.38 * h : 0.38 * h;
    for (let i = 0; i < n; i++) { const g = _wsiWichtel(CS, k, xStart + i * ab, h, stile[i % 3]); A.push(g.alles); W.push(g.weiss); N.push(g.nase); }
    const xEnd = xStart + (n - 1) * ab + 0.38 * h;
    let grund = k(k(CS.union(A)).offset(rand, 'Round', 2, 16));             // Rand um alles
    const leiste = k(k(CS.square([xEnd + (p.modus === 'ecke' ? 0 : 0), hb], false)).translate([0, -hb + 0.5]));
    grund = k(grund.add(leiste));
    if (p.modus === 'ecke') grund = k(grund.add(k(k(CS.square([hb, p.seite], false)).translate([0, -p.seite]))));   // senkrechter Schenkel links (Türrahmen)
    const weiss = k(k(CS.union(W)).subtract(k(CS.union(N)))), nase = k(CS.union(N));
    const out = { grund: k(grund.extrude(t)).translate([0, 0, 0]),
      weiss: k(k(weiss.extrude(aufl)).translate([0, 0, t])).translate([0, 0, 0]),
      nase: k(k(nase.extrude(aufl)).translate([0, 0, t])).translate([0, 0, 0]) };
    if (p.modus === 'aufsteller') {                                          // Steckfuß: Block mit Schlitz (Passung 0,3)
      const L = Math.min(xEnd, 60), fb = 22, fh = 8, sl = t + 0.3;
      let fuss = k(M.cube([L, fb, fh], false));
      fuss = k(fuss.subtract(k(M.cube([L + 2, sl, fh - 2.5], false).translate([-1, fb / 2 - sl / 2, 2.5]))));
      out.fuss = fuss.translate([0, -hb - fb - 15, 0]);
    }
    out.info = { breite: xEnd, hoehe: h * 1.05 + hb, n };
    return out;
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
