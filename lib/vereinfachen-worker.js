// Netz vereinfachen im Hintergrund (V3D CAD) — meshoptimizer (MIT, lib/meshopt_simplifier.js).
// Eingabe: Dreiecksliste (9 Floats je Dreieck) + entweder
//   tol     = höchste Abweichung in den Einheiten der Liste (Import: mm) — Qualität fest,
//             die Dreieckszahl ergibt sich daraus, oder
//   target  = gewünschte Dreieckszahl (Werkzeug „🔻 Vereinfachen" mit Schieber).
// Ränder offener Netze bleiben fest (LockBorder), damit Scan-Kanten nicht wandern.
// Ausgabe: neue Dreiecksliste + gemeldeter Fehler (meshopt-Schätzung, gleiche Einheit).
importScripts('meshopt_simplifier.js');
const M = self.MeshoptSimplifier;

self.onmessage = async (e) => {
  const d = e.data || {};
  try {
    await M.ready;
    const soup = d.pos, nV = soup.length / 3;
    // gleiche Punkte WIRKLICH zusammenführen (Dreieckssuppe → indiziertes Netz mit
    // eindeutigen Punkten). Nur umindizieren reicht nicht: meshopt hält mehrere Punkte
    // an derselben Stelle für Nähte und sperrt sie — dann wird gar nichts vereinfacht.
    const remap = M.generatePositionRemap(soup, 3), newId = new Uint32Array(nV);
    let nU = 0;
    for (let i = 0; i < nV; i++) newId[i] = remap[i] === i ? nU++ : newId[remap[i]];
    const pos = new Float32Array(nU * 3), idx = new Uint32Array(nV);
    for (let i = 0; i < nV; i++) {
      const u = newId[i]; idx[i] = u;
      if (remap[i] === i) { pos[u * 3] = soup[i * 3]; pos[u * 3 + 1] = soup[i * 3 + 1]; pos[u * 3 + 2] = soup[i * 3 + 2]; }
    }
    const useTol = d.tol > 0;
    const targetIdx = useTol ? 3 : Math.max(3, Math.round(d.target) * 3);
    // ohne Toleranz: Fehler unbegrenzt (relativ 1 = ganze Modellgröße), nur die Zahl zählt
    const [out, err] = M.simplify(idx, pos, 3, targetIdx, useTol ? d.tol : 1,
      useTol ? ['ErrorAbsolute', 'LockBorder'] : ['LockBorder']);
    const res = new Float32Array(out.length * 3);
    for (let i = 0; i < out.length; i++) {
      const s = out[i] * 3, t = i * 3;
      res[t] = pos[s]; res[t + 1] = pos[s + 1]; res[t + 2] = pos[s + 2];
    }
    // relativer Fehler (ohne Toleranz) → in Modelleinheiten umrechnen
    const scale = useTol ? 1 : M.getScale(pos, 3);
    self.postMessage({ id: d.id, pos: res, err: err * scale, inTris: idx.length / 3, outTris: out.length / 3 }, [res.buffer]);
  } catch (err) {
    self.postMessage({ id: d.id, error: String((err && err.message) || err) });
  }
};
