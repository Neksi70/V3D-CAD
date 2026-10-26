/* V3D CAD True Nest – Verschachtel-Worker.
 * Rechnet auf Rastern (Zellen), die der Hauptthread vorbereitet:
 *   sheets[k].occ  = belegt (außerhalb der Platte inkl. Randabstand, fremde Teile inkl. Abstand)
 *   shapes[s]      = Teilmaske je Drehung: cells (Zellen des Teils, gestreut sortiert),
 *                    halo (Teil + Abstand, w×h), anc (erste Zelle spaltenweise), maxI/maxJ
 *   units[u]       = { area, vars:[shapeIndex …] }  (Einheit = Teil oder Gruppe überlappender Teile)
 * Platzierung: Bottom-Left-Fill spaltenweise (Teile rutschen an die linke Kante,
 * der Rest der Platte bleibt am Stück), je Teil die Drehung mit der kleinsten
 * rechten Kante. Danach lokale Suche über die Reihenfolge, bis die Suchzeit um ist.
 * Jede Verbesserung geht sofort als 'best' an den Hauptthread (Stopp = terminate). */
'use strict';

let G = null;   // { gw, gh, sheets, shapes, units, maxSheets }

function fits(o, gw, gh, S, gi, gj) {
  if (gi < 0 || gj < 0 || gi + S.w > gw || gj + S.h > gh) return false;
  const c = S.cells;
  for (let k = 0; k < c.length; k += 2) if (o[(gj + c[k + 1]) * gw + gi + c[k]]) return false;
  return true;
}

// Erste passende Lage (spaltenweise von links), höchstens bis zur rechten Kante lim
function firstFit(sh, S, lim) {
  const { gw, gh } = G, o = sh.occ, free = sh.colFree;
  const aI = S.anc[0], aJ = S.anc[1];
  const iMax = Math.min(gw - 1, lim - 1 - S.maxI + aI);
  for (let i = Math.max(0, aI); i <= iMax; i++) {
    if (!free[i]) continue;
    const gi = i - aI;
    if (gi + S.w > gw) break;
    for (let j = aJ, jEnd = gh - S.h + aJ; j <= jEnd; j++) {
      if (o[j * gw + i]) continue;
      if (fits(o, gw, gh, S, gi, j - aJ)) return [gi, j - aJ];
    }
  }
  return null;
}

function stamp(sh, S, gi, gj) {
  const { gw, gh } = G, o = sh.occ, h = S.halo;
  for (let y = 0; y < S.h; y++) {
    const jj = gj + y; if (jj < 0 || jj >= gh) continue;
    for (let x = 0; x < S.w; x++) {
      if (!h[y * S.w + x]) continue;
      const ii = gi + x; if (ii < 0 || ii >= gw) continue;
      const k = jj * gw + ii;
      if (!o[k]) { o[k] = 1; sh.colFree[ii]--; }
    }
  }
  const r = gi + S.maxI + 1; if (r > sh.ext) sh.ext = r;
}

function colFreeOf(occ) {
  const cf = new Int32Array(G.gw);
  for (let j = 0; j < G.gh; j++) for (let i = 0; i < G.gw; i++) if (!occ[j * G.gw + i]) cf[i]++;
  return cf;
}
function freshSheet(k) {
  const b = k < G.sheets.length ? G.sheets[k] : G.blankSheet;
  return { occ: b.occ.slice(), colFree: b.colFree.slice(), ext: 0 };
}

// Reihenfolge → Lagen + Kosten (weniger ist besser)
function evaluate(order) {
  const sheets = [freshSheet(0)];
  const res = new Array(G.units.length).fill(null);
  let unplaced = 0;
  for (const u of order) {
    const U = G.units[u];
    let done = false;
    for (let s = 0; !done; s++) {
      if (s === sheets.length) {
        if (sheets.length >= G.maxSheets) break;
        if (s >= G.sheets.length && !U.fitsBlank) break;   // passt auf keine leere Platte
        sheets.push(freshSheet(s));
      }
      const sh = sheets[s];
      let best = null, lim = G.gw + 1;
      for (const vi of U.vars) {
        const S = G.shapes[vi];
        const p = firstFit(sh, S, lim);
        if (!p) continue;
        const r = p[0] + S.maxI + 1, b = p[1] + S.maxJ + 1;
        if (!best || r < best.r || (r === best.r && b < best.b)) { best = { vi, gi: p[0], gj: p[1], r, b }; lim = r + 1; }
      }
      if (best) {
        stamp(sh, G.shapes[best.vi], best.gi, best.gj);
        res[u] = { sheet: s, shape: best.vi, gi: best.gi, gj: best.gj };
        done = true;
      }
    }
    if (!done) unplaced++;
  }
  // Leere Platten am Ende abschneiden
  let n = sheets.length;
  while (n > 1 && !res.some(r => r && r.sheet === n - 1)) n--;
  const last = sheets[n - 1].ext;
  // Summe der Lagen als feiner Gleichstandsbrecher (alles möglichst links)
  let tie = 0;
  for (const r of res) if (r) tie += r.gi + r.sheet * G.gw;
  const len = (n - 1) * G.gw + last;
  return { res, unplaced, sheets: n, len, cost: unplaced * 1e12 + len * 1e6 + tie };
}

let _seed = 12345;
function rnd() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

function mutate(order) {
  const o = order.slice(), n = o.length;
  if (n < 2) return o;
  const m = rnd();
  if (m < 0.45) {                         // zwei benachbarte tauschen
    const i = (rnd() * (n - 1)) | 0; const t = o[i]; o[i] = o[i + 1]; o[i + 1] = t;
  } else if (m < 0.8) {                   // zwei beliebige tauschen
    const i = (rnd() * n) | 0, j = (rnd() * n) | 0; const t = o[i]; o[i] = o[j]; o[j] = t;
  } else {                                // eins nach vorn ziehen
    const i = (rnd() * n) | 0, j = (rnd() * (i + 1)) | 0; const [x] = o.splice(i, 1); o.splice(j, 0, x);
  }
  return o;
}

function post(type, r, it, t0, first) {
  self.postMessage({ type, it, ms: Date.now() - t0, res: r.res, unplaced: r.unplaced, sheets: r.sheets, len: r.len, len0: first.len });
}

self.onmessage = (e) => {
  const d = e.data;
  if (d.cmd !== 'run') return;
  G = d;
  for (const sh of G.sheets) sh.colFree = colFreeOf(sh.occ);
  G.blankSheet = { occ: d.blank, colFree: colFreeOf(d.blank) };
  for (const U of G.units) U.fitsBlank = U.vars.some(vi => firstFit({ occ: d.blank, colFree: G.blankSheet.colFree }, G.shapes[vi], G.gw + 1));
  _seed = d.seed || 12345;
  const t0 = Date.now();
  const n = G.units.length;
  // Startreihenfolgen: nach Fläche, nach Breite, nach Tiefe (groß zuerst)
  const byKey = key => [...Array(n).keys()].sort((a, b) => G.units[b][key] - G.units[a][key] || a - b);
  let best = null, first = null, it = 0;
  for (const key of ['area', 'wid', 'dep']) {
    const r = evaluate(byKey(key)); it++;
    r.order = byKey(key);
    if (!first) first = r;
    if (!best || r.cost < best.cost) { best = r; post('best', best, it, t0, first); }
  }
  let cur = best, lastPost = Date.now(), stale = 0;
  while (Date.now() - t0 < d.timeMs && n > 1) {
    const ord = mutate(cur.order);
    const r = evaluate(ord); r.order = ord; it++;
    if (r.cost <= cur.cost) { cur = r; stale = 0; } else stale++;
    if (r.cost < best.cost) { best = r; post('best', best, it, t0, first); lastPost = Date.now(); }
    // Festgefahren → vom Besten aus mit ein paar Zufallszügen neu ansetzen
    if (stale > 60) { let o = best.order; for (let k = 0; k < 3; k++) o = mutate(o); cur = evaluate(o); cur.order = o; it++; stale = 0; }
    if (Date.now() - lastPost > 400) { self.postMessage({ type: 'tick', it, ms: Date.now() - t0 }); lastPost = Date.now(); }
  }
  post('done', best, it, t0, first);
};
