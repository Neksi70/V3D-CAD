// Testkarte für Ralf: dasselbe Portrait sechsmal — drei Relief-Tiefen,
// jeweils normal und als Hohlform. Alles auf einer Grundplatte, damit es als
// EIN Teil vom Drucker kommt und man direkt nebeneinander vergleichen kann.
//
//   node make_relieftest.mjs [foto.jpg] [ausgabe.stl]
//
// Ohne Foto wird ein synthetisches Gesicht benutzt — das reicht zum Prüfen der
// Geometrie, für die Beurteilung des Effekts sollte ein echtes Portrait rein.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname, basename } from 'node:path';

const fotoPfad = process.argv[2] || null;
const ausgabe  = process.argv[3] || '/home/v3da/relieftest.stl';
const TIEFEN   = [0.4, 0.6, 0.9];

let dataUrl = null;
if (fotoPfad) {
  const typ = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp' }[extname(fotoPfad).toLowerCase()];
  if (!typ) { console.error('Nur jpg/png/webp'); process.exit(1); }
  dataUrl = `data:image/${typ};base64,` + readFileSync(fotoPfad).toString('base64');
  console.log(`Foto: ${basename(fotoPfad)}`);
} else {
  console.log('Foto: (synthetisch — für die echte Beurteilung ein Portrait mitgeben)');
}

const PORT = 8816;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1400);

const res = await page.evaluate(async ({ dataUrl, TIEFEN }) => {
  if (typeof hideStarter === 'function') hideStarter();

  const img = await new Promise((r, j) => {
    const i = new Image(); i.onload = () => r(i); i.onerror = j;
    if (dataUrl) { i.src = dataUrl; return; }
    // Ersatzgesicht, falls kein Foto mitgegeben wurde
    const cv = document.createElement('canvas'); cv.width = 420; cv.height = 520;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#1a1a1a'; cx.fillRect(0, 0, 420, 520);
    const g = cx.createRadialGradient(200, 210, 15, 210, 240, 190);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#c8c8c8'); g.addColorStop(1, '#3a3a3a');
    cx.fillStyle = g; cx.beginPath(); cx.ellipse(210, 245, 135, 172, 0, 0, 7); cx.fill();
    cx.fillStyle = '#5a5a5a'; cx.beginPath(); cx.ellipse(210, 560, 230, 170, 0, 0, 7); cx.fill();
    cx.fillStyle = '#141414';
    cx.beginPath(); cx.ellipse(160, 215, 20, 11, 0, 0, 7); cx.fill();
    cx.beginPath(); cx.ellipse(258, 215, 20, 11, 0, 0, 7); cx.fill();
    cx.strokeStyle = '#0d0d0d'; cx.lineWidth = 6;
    cx.beginPath(); cx.arc(209, 300, 46, 0.35, Math.PI - 0.35); cx.stroke();
    cx.fillStyle = '#f4f4f4'; cx.beginPath(); cx.ellipse(209, 262, 17, 34, 0, 0, 7); cx.fill();
    i.src = cv.toDataURL();
  });
  _vk.img = img;

  const KACHEL_B = 36, KACHEL_H = 44, SCHILD_H = 10, LUFT = 3;
  const PLATTE_D = 0.8, BASIS = 1.2;
  const spaltenX = [-(KACHEL_B + LUFT), 0, KACHEL_B + LUFT];
  const BLOCK = KACHEL_H + LUFT + SCHILD_H;          // Kachel + Luft + Beschriftung
  const zeilen = [
    { hohl: false, z: -(BLOCK + LUFT) / 2, suffix: '' },
    { hohl: true,  z:  (BLOCK + LUFT) / 2, suffix: ' hohl' },
  ];

  const meshes = [];
  const setzen = (geo, xmm, zmm) => {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
    m.userData = { isHole: false };
    m.position.set(xmm / 10, 0, zmm / 10);
    meshes.push(m);
  };

  // Gemeinsame Einstellungen für alle Kacheln
  const grund = () => {
    Object.assign(_vk.p, {
      preset: 'karte', stand: false, base: BASIS, r: 2, marg: 2,
      plastik: 60, glatt: 1, tmode: 'raised', talign: 'mitte', hohl: false,
      font: 'Arial, Helvetica, sans-serif', name: '', l2: '', l3: '', l4: '',
    });
  };

  let tris = 0;
  for (const zeile of zeilen) {
    for (let i = 0; i < TIEFEN.length; i++) {
      // Relief-Kachel: Foto füllt die ganze Kachel, kein Text darüber
      grund();
      Object.assign(_vk.p, { w: KACHEL_B, h: KACHEL_H, photo: 'voll',
        relief: TIEFEN[i], hohl: zeile.hohl, res: 140 });
      const gk = _buildVkGeo(false);
      tris += gk.index.count / 3;
      setzen(gk, spaltenX[i], zeile.z - (SCHILD_H + LUFT) / 2);

      // Beschriftung darunter (bei der Hohl-Zeile darüber wäre sie verdeckt)
      grund();
      Object.assign(_vk.p, { w: KACHEL_B, h: SCHILD_H, photo: 'kein', r: 1.5, marg: 1.5,
        name: String(TIEFEN[i]).replace('.', ',') + zeile.suffix,
        tsize: 4.5, traise: 0.5, res: 120 });
      const gs = _buildVkGeo(false);
      tris += gs.index.count / 3;
      setzen(gs, spaltenX[i], zeile.z + (KACHEL_H + LUFT) / 2);
    }
  }

  // Grundplatte: verbindet alles zu einem Teil. Die Kacheln stehen ab y=0,
  // die Platte liegt in derselben Höhe → sie verschmelzen beim Slicen.
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const m of meshes) {
    m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox;
    x0 = Math.min(x0, (b.min.x + m.position.x) * 10); x1 = Math.max(x1, (b.max.x + m.position.x) * 10);
    z0 = Math.min(z0, (b.min.z + m.position.z) * 10); z1 = Math.max(z1, (b.max.z + m.position.z) * 10);
  }
  const rand = 3;
  const pw = (x1 - x0) + 2 * rand, pd = (z1 - z0) + 2 * rand;
  const platte = new THREE.BoxGeometry(pw / 10, PLATTE_D / 10, pd / 10);
  platte.translate(0, PLATTE_D / 20, 0);
  setzen(platte, (x0 + x1) / 2, (z0 + z1) / 2);

  const stl = _buildStlBlob(meshes);
  if (!stl || !stl.blob) return { fehler: 'kein STL' };
  const buf = await stl.blob.arrayBuffer();
  const u8 = new Uint8Array(buf);
  let bin = ''; const ch = 0x8000;
  for (let i = 0; i < u8.length; i += ch) bin += String.fromCharCode.apply(null, u8.subarray(i, i + ch));

  // Vorschaubild: flacher Blickwinkel und ein Material mit Ton — von oben und
  // in Weiß sieht man die Tiefenunterschiede nicht.
  for (const m of meshes) {
    m.material = new THREE.MeshStandardMaterial({ color: 0x9aa7b4, roughness: 0.75, metalness: 0.05 });
    scene.add(m);
  }
  camera.position.set(0, 9, 16); camera.lookAt(0, 0, 0.5);
  if (typeof controls !== 'undefined' && controls) { controls.target.set(0, 0, 0.5); controls.update(); }
  renderer.render(scene, camera);
  const png = renderer.domElement.toDataURL('image/png');

  return { b64: btoa(bin), png, tris: Math.round(tris), teile: meshes.length,
           platte: { b: +pw.toFixed(1), t: +pd.toFixed(1) } };
}, { dataUrl, TIEFEN });

if (res.fehler) { console.error(res.fehler); process.exit(1); }
writeFileSync(ausgabe, Buffer.from(res.b64, 'base64'));
const bild = ausgabe.replace(/\.stl$/i, '') + '.png';
writeFileSync(bild, Buffer.from(res.png.split(',')[1], 'base64'));
console.log(`\nGrundplatte  ${res.platte.b} × ${res.platte.t} mm`);
console.log(`Kacheln      ${TIEFEN.map(t => t + ' mm').join(' / ')} — je einmal normal und hohl`);
console.log(`Dreiecke     ${(res.tris / 1000).toFixed(0)}k in ${res.teile} Teilen`);
console.log(`Seitenfehler ${errs.length ? errs : 'keine'}`);
console.log(`\n-> ${ausgabe}`);
console.log(`-> ${bild}  (Vorschau)`);
await browser.close(); srv.kill();
process.exit(errs.length ? 1 : 0);
