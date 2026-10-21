// Netz vereinfachen im Hintergrund (V3D CAD) — meshoptimizer (MIT, lib/meshopt_simplifier.js).
// Eingabe: Dreiecksliste (9 Floats je Dreieck) + entweder
//   tol     = höchste Abweichung in den Einheiten der Liste (Import: mm) — Qualität fest,
//             die Dreieckszahl ergibt sich daraus, oder
//   target  = gewünschte Dreieckszahl (Werkzeug „🔻 Vereinfachen" mit Schieber),
//   sloppy  = mit target: schnelle Grob-Reduktion für Vorschaubilder,
//   stl     = binäre STL-Bytes statt pos (Vorschaubild: Lesen auch im Worker).
// Ränder offener Netze bleiben fest (LockBorder), damit Scan-Kanten nicht wandern.
// Ausgabe: neue Dreiecksliste + gemeldeter Fehler (meshopt-Schätzung, gleiche Einheit).
importScripts('meshopt_simplifier.js');
const M = self.MeshoptSimplifier;

self.onmessage = async (e) => {
  const d = e.data || {};
  try {
    await M.ready;
    // Vorschaubild der Bibliothek: binäre STL direkt hier lesen (Haupt-Thread bleibt frei)
    let soup = d.pos;
    if (d.stl) {
      const dv = new DataView(d.stl), n = dv.getUint32(80, true);
      if (d.stl.byteLength !== 84 + n * 50) throw new Error('keine binäre STL');
      soup = new Float32Array(n * 9); let w = 0;
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12; let ok = true;
        for (let k = 0; k < 9; k++) { const v = dv.getFloat32(o + k * 4, true); soup[w + k] = v; if (!Number.isFinite(v)) ok = false; }
        if (ok) w += 9;
      }
      if (w < soup.length) soup = soup.slice(0, w);
      if (soup.length / 9 <= d.target) { self.postMessage({ id: d.id, pos: soup, err: 0, inTris: soup.length / 9, outTris: soup.length / 9 }, [soup.buffer]); return; }
    }
    const nV = soup.length / 3;
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
    // sloppy: schnell und grob — nur für Vorschaubilder (256×192 px), nie für Modelle
    const [out, err] = d.sloppy
      ? M.simplifySloppy(idx, pos, 3, null, targetIdx, 1)
      : M.simplify(idx, pos, 3, targetIdx, useTol ? d.tol : 1, useTol ? ['ErrorAbsolute', 'LockBorder'] : ['LockBorder']);
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
