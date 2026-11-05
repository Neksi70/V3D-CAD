/*
 * Strebe → Spline — Hintergrund-Rechner (Web-Worker) für V3D CAD.
 * Hält den Scan (bis >1 Mio Dreiecke) und rechnet die schweren Schritte 0–2,
 * damit die Seite nicht einfriert. Splines/Symmetrie/Abweichung sind leicht
 * und laufen im Hauptthread (gleicher Kern).
 */
importScripts('strebenspline-kern.js');
const K = self.StrebenKern;
let roh = null, meshRoh = null, A = null, meshAl = null, streben = null;

function ausduennen(mesh, tri, max) {   // Schwerpunkte einer Strebe fürs Kontrollbild
  const n = tri.length, step = Math.max(1, Math.ceil(n / max)), out = new Float32Array(Math.ceil(n / step) * 3);
  let k = 0;
  for (let i = 0; i < n; i += step) { const t = tri[i]; out[k++] = mesh.cen[3 * t]; out[k++] = mesh.cen[3 * t + 1]; out[k++] = mesh.cen[3 * t + 2]; }
  return out.subarray(0, k);
}
function seiteKurz(s) {
  if (!s) return null;
  return { vorzeichen: s.vorzeichen, zMin: s.zMin, zMax: s.zMax, laenge: s.laenge, pfad: s.pfad, nTri: s.tri.length, verworfen: s.verworfen, teile: s.teile, punkte: ausduennen(meshAl, s.tri, 60000) };
}

const BEFEHLE = {
  laden({ pos, matrix }) {   // pos = lokale Koordinaten, matrix = lokal → Welt-mm (Z oben)
    roh = K.transformTris(pos, matrix);
    meshRoh = K.makeMesh(roh); meshAl = meshRoh; A = K.M4.ident(); streben = null;
    const g = meshRoh.grid;
    return { nTri: meshRoh.nTri, min: g.mn, max: [0, 1, 2].map(a => g.mn[a] + g.dim[a] * g.cell) };
  },
  ausrichten({ opt }) {
    const al = K.ausrichten(meshRoh, opt || {});
    A = al.matrix; meshAl = K.makeMesh(K.transformTris(roh, A)); streben = null;
    return al;
  },
  matrixSetzen({ matrix }) {   // z. B. aus geladener JSON oder "ohne Ausrichtung"
    A = matrix; meshAl = (matrix.join() === K.M4.ident().join()) ? meshRoh : K.makeMesh(K.transformTris(roh, A)); streben = null;
    return true;
  },
  streben({ prm }) {
    streben = K.strebenFinden(meshAl, prm);
    return { links: seiteKurz(streben.links), rechts: seiteKurz(streben.rechts) };
  },
  tauschen() { streben = { links: streben.rechts, rechts: streben.links }; return { links: seiteKurz(streben.links), rechts: seiteKurz(streben.rechts) }; },
  kamm({ prm, seite }) {
    if (!streben || !streben[seite]) throw new Error('Strebe ' + seite + ' fehlt – erst Schritt 1');
    return K.kammZweiPass(meshAl, streben[seite], prm);
  },
  profil({ prm, seite, p, t, vorB }) {   // ein einzelner Schnitt fürs Detailbild
    const triSet = new Uint8Array(meshAl.nTri); for (const i of streben[seite].tri) triSet[i] = 1;
    const prof = K.schnittProfil(meshAl, triSet, p, t, prm.suchRadius);
    return { prof, kamm: K.kammPunkt(prof, p, t, prm, vorB || null) };
  },
};

self.onmessage = e => {
  const { id, cmd, args } = e.data;
  const t0 = Date.now();
  try {
    const res = BEFEHLE[cmd](args || {});
    self.postMessage({ id, ok: true, res, ms: Date.now() - t0 });
  } catch (err) {
    self.postMessage({ id, ok: false, fehler: String(err && err.message || err) });
  }
};
