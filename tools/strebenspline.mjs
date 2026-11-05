#!/usr/bin/env node
// Strebe → Spline, Schritt für Schritt auf der Kommandozeile (gleicher Rechenkern wie in V3D CAD).
// Jeder Aufruf rechnet EINEN Schritt, schreibt Kontrollbild (PNG) + Messwerte (TXT) in den
// Arbeitsordner und merkt sich den Stand in strebenspline_stand.json → dann auf OK warten.
//
//   node tools/strebenspline.mjs <schritt> --scan <Colani_001.stl> --ordner <arbeitsordner> [optionen]
//     schritt: 0 1 2 3 4 5 6 | params
//     --param name=wert   (mehrfach) z. B. --param glaettung=6 --param stuetzpunkte=5
//     --tauschen          Schritt 1: links/rechts vertauschen
//     --modus ausgleich|stuetz   Schritt 3: Ausgleichsspline oder Spline durch Stützpunkte
//     --mitteln           Schritt 4: gemittelten Spline auf beide Seiten übernehmen
//     --original          Schritt 4: gemittelten Spline verwerfen
// Das Original-STL wird nie verändert. Kontrollbilder brauchen Playwright/Chromium
// (PW_CHROMIUM=/pfad/zu/chrome setzt den Browser, sonst Playwright-Standard).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const HIER = path.dirname(fileURLToPath(import.meta.url));
const K = require(path.join(HIER, '../lib/strebenspline-kern.js'));

// ── Argumente ─────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const schritt = argv[0];
const opt = { param: [] };
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--param') opt.param.push(argv[++i]);
  else if (a.startsWith('--')) { const k = a.slice(2); const n = argv[i + 1]; if (n && !n.startsWith('--')) { opt[k] = n; i++; } else opt[k] = true; }
}
if (!schritt || !opt.ordner) {
  console.log('Aufruf: node tools/strebenspline.mjs <0|1|2|3|4|5|6|params> --scan <stl> --ordner <ordner> [--param name=wert]');
  process.exit(1);
}
const ORD = path.resolve(opt.ordner);
fs.mkdirSync(ORD, { recursive: true });
const STAND = path.join(ORD, 'strebenspline_stand.json');
let stand = fs.existsSync(STAND) ? JSON.parse(fs.readFileSync(STAND, 'utf8')) : {};
stand.prm = Object.assign({}, K.PARAM_DEFAULT, stand.prm || {});
if (opt.scan) stand.scan = path.resolve(opt.scan);
for (const p of opt.param) {
  const [k, v] = p.split('=');
  if (!(k in K.PARAM_DEFAULT)) { console.error('Unbekannter Parameter:', k, '\nBekannt:', Object.keys(K.PARAM_DEFAULT).join(', ')); process.exit(1); }
  stand.prm[k] = parseFloat(v);
}
const prm = stand.prm;
const speichern = () => fs.writeFileSync(STAND, JSON.stringify(stand, null, 1));
const txt = [];
const log = s => { console.log(s); txt.push(s); };
const f2 = v => (v == null || !Number.isFinite(v)) ? '–' : v.toFixed(2);

// ── STL lesen / schreiben ─────────────────────────────────────────────────────
function stlLesen(datei) {
  const buf = fs.readFileSync(datei);
  const n = buf.readUInt32LE(80);
  if (buf.length === 84 + 50 * n) {
    const pos = new Float32Array(9 * n); let k = 0;
    for (let i = 0; i < n; i++) { const o = 84 + 50 * i + 12; let ok = true; const t = []; for (let j = 0; j < 9; j++) { const v = buf.readFloatLE(o + 4 * j); if (!Number.isFinite(v)) ok = false; t.push(v); } if (ok) { pos.set(t, k); k += 9; } }
    return pos.subarray(0, k);
  }
  const s = buf.toString('latin1'), re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g, v = []; let m;
  while ((m = re.exec(s))) v.push(+m[1], +m[2], +m[3]);
  return Float32Array.from(v.slice(0, v.length - v.length % 9));
}
function stlSchreiben(datei, pos, kopf) {
  const n = pos.length / 9, buf = Buffer.alloc(84 + 50 * n);
  buf.write((kopf || 'V3D CAD').slice(0, 79), 0); buf.writeUInt32LE(n, 80);
  for (let i = 0; i < n; i++) {
    const o = 84 + 50 * i, p = pos.subarray(9 * i, 9 * i + 9);
    const ux = p[3] - p[0], uy = p[4] - p[1], uz = p[5] - p[2], vx = p[6] - p[0], vy = p[7] - p[1], vz = p[8] - p[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
    buf.writeFloatLE(nx / l, o); buf.writeFloatLE(ny / l, o + 4); buf.writeFloatLE(nz / l, o + 8);
    for (let k = 0; k < 9; k++) buf.writeFloatLE(p[k], o + 12 + 4 * k);
  }
  fs.writeFileSync(datei, buf);
}

// ── Scan laden (Original, nie verändert) ──────────────────────────────────────
let _roh = null, _al = null, _meshAl = null;
function roh() {
  if (_roh) return _roh;
  if (!stand.scan || !fs.existsSync(stand.scan)) { console.error('Scan fehlt: --scan <datei.stl>'); process.exit(1); }
  const t = Date.now(); _roh = stlLesen(stand.scan);
  console.log(`Scan gelesen: ${path.basename(stand.scan)} · ${(_roh.length / 9).toLocaleString('de')} Dreiecke · ${((Date.now() - t) / 1000).toFixed(1)} s`);
  return _roh;
}
function ausgerichtet() {
  if (!stand.matrix) { console.error('Erst Schritt 0 (Ausrichtung)'); process.exit(1); }
  if (!_al) _al = K.transformTris(roh(), stand.matrix);
  return _al;
}
function meshAl() { if (!_meshAl) _meshAl = K.makeMesh(ausgerichtet()); return _meshAl; }
function streben() {
  const st = K.strebenFinden(meshAl(), prm);
  return stand.tauschen ? { links: st.rechts, rechts: st.links } : st;
}
const SEITEN = ['links', 'rechts'];

// ── Kontrollbild: Three.js headless (Scan + Overlays, Vorder- und Seitenansicht) ─
async function kontrollbild(name, titel, overlays, extra = {}) {
  let chromium;
  try { ({ chromium } = await import('@playwright/test')); } catch (e) { console.log('(Kein Playwright → kein Kontrollbild)'); return; }
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1800, height: extra.diagramm ? 1150 : 950 } });
    const three = fs.readFileSync(path.join(HIER, '../lib/three.min.js'));
    // Scan ausgedünnt als Dreiecke (max. 400 000) — reicht fürs Bild
    const pos = ausgerichtet(), n = pos.length / 9, step = Math.max(1, Math.ceil(n / 400000));
    const scan = new Float32Array(Math.ceil(n / step) * 9); let k = 0;
    for (let i = 0; i < n; i += step) { scan.set(pos.subarray(9 * i, 9 * i + 9), k); k += 9; }
    await page.route('http://ssp.local/**', r => {
      const u = r.request().url();
      if (u.endsWith('/three.js')) return r.fulfill({ body: three, contentType: 'text/javascript' });
      if (u.endsWith('/scan.bin')) return r.fulfill({ body: Buffer.from(scan.buffer, 0, k * 4), contentType: 'application/octet-stream' });
      if (u.endsWith('/daten.json')) return r.fulfill({ body: JSON.stringify({ titel, overlays, extra }), contentType: 'application/json' });
      return r.fulfill({ body: SEITE, contentType: 'text/html' });
    });
    await page.goto('http://ssp.local/');
    await page.waitForFunction(() => window.FERTIG === true, null, { timeout: 120000 });
    const datei = path.join(ORD, name + '.png');
    await page.screenshot({ path: datei });
    console.log('Kontrollbild:', datei);
  } finally { await browser.close(); }
}
const SEITE = `<!doctype html><meta charset=utf-8><body style="margin:0;background:#fff;font:15px system-ui">
<div id=t style="position:absolute;left:14px;top:10px;font-weight:600;font-size:17px;z-index:2"></div>
<div id=l1 style="position:absolute;left:14px;top:38px;color:#555;z-index:2">Vorderansicht (Blick entlang Y)</div>
<div id=l2 style="position:absolute;left:914px;top:38px;color:#555;z-index:2">Seitenansicht (Blick entlang X)</div>
<canvas id=c></canvas><canvas id=d style="display:block"></canvas>
<script src="/three.js"></script><script>
(async()=>{
const D=await (await fetch('/daten.json')).json();
document.getElementById('t').textContent=D.titel;
const W=1800,H=950; const r=new THREE.WebGLRenderer({canvas:document.getElementById('c'),antialias:true,preserveDrawingBuffer:true});
r.setSize(W,H); r.setScissorTest(true); r.setClearColor(0xffffff);
const sc=new THREE.Scene(); sc.add(new THREE.AmbientLight(0xffffff,0.55)); const dl=new THREE.DirectionalLight(0xffffff,0.6); dl.position.set(1,-2,2); sc.add(dl);
const dl2=new THREE.DirectionalLight(0xffffff,0.35); dl2.position.set(-1,2,1); sc.add(dl2);
const buf=await (await fetch('/scan.bin')).arrayBuffer(); const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(buf),3)); g.computeVertexNormals();
sc.add(new THREE.Mesh(g,new THREE.MeshLambertMaterial({color:0xc9ced6,side:THREE.DoubleSide,transparent:true,opacity:D.extra.scanOpak?1:0.55,depthWrite:!!D.extra.scanOpak})));
const V=a=>new THREE.Vector3(a[0],a[1],a[2]);
for(const o of D.overlays){
  if(o.art==='punkte'){const gg=new THREE.BufferGeometry();gg.setAttribute('position',new THREE.Float32BufferAttribute(o.pos,3));
    if(o.farben)gg.setAttribute('color',new THREE.Float32BufferAttribute(o.farben,3));
    const m=new THREE.Points(gg,new THREE.PointsMaterial({size:o.groesse||5,sizeAttenuation:false,vertexColors:!!o.farben,color:o.farbe||0xffffff,depthTest:false}));m.renderOrder=10;sc.add(m);}
  else if(o.art==='linie'){const gg=new THREE.BufferGeometry().setFromPoints(o.pts.map(V));const m=o.strich?new THREE.LineDashedMaterial({color:o.farbe,dashSize:20,gapSize:12,depthTest:false}):new THREE.LineBasicMaterial({color:o.farbe,depthTest:false});
    const l=new THREE.Line(gg,m);if(o.strich)l.computeLineDistances();l.renderOrder=9;sc.add(l);}
  else if(o.art==='rohr'){const c=new THREE.CatmullRomCurve3(o.pts.map(V));const gg=new THREE.TubeGeometry(c,o.pts.length,o.r||6,6,false);
    let mat; if(o.farben){const a=new Float32Array(gg.attributes.position.count*3);const n=o.pts.length;for(let i=0;i<=n;i++)for(let j=0;j<7;j++){const k=i*7+j,f=o.farben[Math.min(i,o.farben.length-1)];if(3*k+2<a.length){a[3*k]=f[0];a[3*k+1]=f[1];a[3*k+2]=f[2];}}
      gg.setAttribute('color',new THREE.BufferAttribute(a,3));mat=new THREE.MeshBasicMaterial({vertexColors:true,depthTest:false});} else mat=new THREE.MeshBasicMaterial({color:o.farbe,depthTest:false});
    const m=new THREE.Mesh(gg,mat);m.renderOrder=8;sc.add(m);}
  else if(o.art==='kugel'){const m=new THREE.Mesh(new THREE.SphereGeometry(o.r||10,16,12),new THREE.MeshBasicMaterial({color:o.farbe,depthTest:false}));m.position.copy(V(o.p));m.renderOrder=11;sc.add(m);}
  else if(o.art==='ebeneX'){const m=new THREE.Mesh(new THREE.PlaneGeometry(o.b,o.h),new THREE.MeshBasicMaterial({color:0x8b5cf6,transparent:true,opacity:0.15,side:THREE.DoubleSide,depthWrite:false}));m.rotation.y=Math.PI/2;m.position.set(0,o.y,o.z);sc.add(m);}
}
g.computeBoundingBox(); const bb=g.boundingBox, c=bb.getCenter(new THREE.Vector3()), s=bb.getSize(new THREE.Vector3());
const ort=(w,h,breite,hoehe)=>{const asp=w/h;let fh=Math.max(hoehe,breite/asp)*1.08;return new THREE.OrthographicCamera(-fh*asp/2,fh*asp/2,fh/2,-fh/2,-1e5,1e5);};
const cams=[]; const vw=W/2;
{const cam=ort(vw,H-50,s.x,s.z);cam.up.set(0,0,1);cam.position.set(c.x,c.y-5000,c.z);cam.lookAt(c);cams.push(cam);}
{const cam=ort(vw,H-50,s.y,s.z);cam.up.set(0,0,1);cam.position.set(c.x+5000,c.y,c.z);cam.lookAt(c);cams.push(cam);}
r.setScissorTest(false);r.setViewport(0,0,W,H);r.clear();r.setScissorTest(true);
cams.forEach((cam,i)=>{r.setViewport(i*vw,0,vw,H-50);r.setScissor(i*vw,0,vw,H-50);r.render(sc,cam);});
// Diagramm (Abweichung über s)
if(D.extra.diagramm){const cv=document.getElementById('d');cv.width=W;cv.height=200;const x=cv.getContext('2d');x.fillStyle='#fafafa';x.fillRect(0,0,W,200);x.font='14px system-ui';
  const rows=D.extra.diagramm,Lm=Math.max(...rows.map(r=>r.L),1),sk=D.extra.skala,x0=90,x1=W-20,zh=(200-30)/rows.length;
  rows.forEach((row,ri)=>{const yc=10+ri*zh+zh/2;x.fillStyle='#333';x.fillText(row.name,10,yc+5);x.strokeStyle='#bbb';x.beginPath();x.moveTo(x0,yc);x.lineTo(x1,yc);x.stroke();
    for(const [sv,wv,f] of row.w){const px=x0+(x1-x0)*sv/Lm,h=Math.max(-1,Math.min(1,wv/sk))*(zh/2-4);x.fillStyle='rgb('+f.map(v=>Math.round(v*255)).join(',')+')';x.fillRect(px-1.5,h>0?yc-h:yc,3,Math.max(1,Math.abs(h)));}});
  x.fillStyle='#333';for(let sv=0;sv<=Lm;sv+=250){const px=x0+(x1-x0)*sv/Lm;x.fillText(sv,px-10,196);}x.fillText('±'+sk+' mm',10,196);}
window.FERTIG=true;})();
</script>`;

const FARBE = { links: 0xF97316, rechts: 0x0EA5E9, gemittelt: 0xD946EF };
const GRUND = { ok: [0.09, 0.64, 0.29], loch: [0.6, 0.6, 0.6], ausreisser: [0.86, 0.15, 0.15], unvollstaendig: [0.92, 0.7, 0.03], fehlform: [0.92, 0.7, 0.03], flach: [0.92, 0.7, 0.03] };
const kammOverlay = (k, abw, sk) => {
  const pos = [], farben = []; const m = abw ? new Map(abw.werte.map(w => [w.sKamm, w.wert])) : null;
  for (const q of k) { const p = q.ok ? q.p : q.leit; pos.push(...p); farben.push(...(q.ok && m && m.has(q.s) ? K.farbe(m.get(q.s), sk) : (GRUND[q.ok ? 'ok' : q.grund] || GRUND.flach))); }
  return { art: 'punkte', pos, farben, groesse: 5 };
};
const splineOverlay = (sp, farbe, farben) => ({ art: 'rohr', pts: K.bsSample(sp, 300), farbe, farben, r: 5 });
const griffOverlay = sp => ({ art: 'punkte', pos: (sp.stuetz || sp.ctrl).flat(), farbe: 0x111827, groesse: 9 });

function splineAktiv(s) { return stand.gemittelt ? stand.gemittelt[s] : stand.spline && stand.spline[s]; }
function txtSchreiben(name) { fs.writeFileSync(path.join(ORD, name + '.txt'), txt.join('\n') + '\n'); console.log('Messwerte:  ', path.join(ORD, name + '.txt')); }

// ── Schritte ──────────────────────────────────────────────────────────────────
async function s0() {
  const mesh = K.makeMesh(roh());
  const t = Date.now();
  const al = K.ausrichten(mesh, { nickWinkel: prm.nickWinkel });
  stand.matrix = al.matrix; stand.ausrichtung = { rms: al.rms, anteil: al.anteil, ebene: al.ebene, spitze: al.spitze };
  delete stand.kamm; delete stand.spline; delete stand.gemittelt; delete stand.stuetz;
  _al = null; _meshAl = null;
  const ziel = path.join(ORD, path.basename(stand.scan).replace(/_?\d*\.stl$/i, '').replace(/\.stl$/i, '') + '_aligned.stl');
  stlSchreiben(ziel, ausgerichtet(), 'V3D CAD ausgerichtet: Mitte X=0, Spitze 0');
  stand.aligned = ziel;
  const p = ausgerichtet(); let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { if (p[i + a] < mn[a]) mn[a] = p[i + a]; if (p[i + a] > mx[a]) mx[a] = p[i + a]; }
  log(`SCHRITT 0 – Ausrichtung (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  log(`Symmetrie-Restfehler (Punkt-zu-Fläche, RMS): ${f2(al.rms)} mm`);
  log(`Anteil Punkte mit Spiegelpartner: ${(al.anteil * 100).toFixed(0)} %   (rechte Strebe kürzer → < 100 % normal)`);
  log(`Ebene im Scan: n = (${al.ebene.n.map(v => v.toFixed(5)).join(', ')}), d = ${f2(al.ebene.d)} mm`);
  log(`Spitze im Scan: (${al.spitze.map(f2).join(', ')}) mm → jetzt Ursprung`);
  log(`Nickwinkel (Parameter): ${prm.nickWinkel}°  – Hochachse = Scan-Z in die Symmetrieebene projiziert`);
  log(`Maße ausgerichtet: X ${f2(mn[0])} … ${f2(mx[0])} · Y ${f2(mn[1])} … ${f2(mx[1])} · Z ${f2(mn[2])} … ${f2(mx[2])} mm`);
  log('Transformationsmatrix Scan-mm → ausgerichtet (Zeilen, p\' = M·p):');
  for (let r = 0; r < 4; r++) log('  ' + al.matrix.slice(4 * r, 4 * r + 4).map(v => (Math.abs(v) < 1e-12 ? 0 : v).toFixed(r < 3 ? 6 : 0).padStart(13)).join(''));
  log(`Ausgerichteter Scan: ${ziel}  (Original unverändert)`);
  fs.writeFileSync(path.join(ORD, 'transformation.json'), JSON.stringify({ von: stand.scan, nach: ziel, matrix_zeilen: al.matrix, ...stand.ausrichtung }, null, 1));
  speichern(); txtSchreiben('0_ausrichtung');
  await kontrollbild('0_ausrichtung', `Schritt 0 – Ausrichtung · Restfehler ${f2(al.rms)} mm · violett = Fahrzeugmitte X=0`, [
    { art: 'ebeneX', b: mx[1] - mn[1] + 200, h: mx[2] - mn[2] + 200, y: (mn[1] + mx[1]) / 2, z: (mn[2] + mx[2]) / 2 },
    { art: 'linie', pts: [[0, 0, 0], [300, 0, 0]], farbe: 0xef4444 }, { art: 'linie', pts: [[0, 0, 0], [0, 300, 0]], farbe: 0x22c55e }, { art: 'linie', pts: [[0, 0, 0], [0, 0, 300]], farbe: 0x3b82f6 },
    { art: 'kugel', p: [0, 0, 0], r: 14, farbe: 0x8b5cf6 }], { scanOpak: true });
}
async function s1() {
  if (opt.tauschen) stand.tauschen = !stand.tauschen;
  const st = streben(); delete stand.kamm; delete stand.spline; delete stand.gemittelt;
  log('SCHRITT 1 – Streben erkennen');
  for (const s of SEITEN) { const v = st[s]; log(v ? `${s.padEnd(6)}: X ${v.vorzeichen < 0 ? '< 0' : '> 0'} · Z ${f2(v.zMin)} … ${f2(v.zMax)} mm · Länge ≈ ${v.laenge.toFixed(0)} mm · ${v.tri.length.toLocaleString('de')} Dreiecke · ${v.verworfen.toLocaleString('de')} Dreiecke anderer Teile verworfen` : `${s}: NICHT gefunden`); }
  log(`Zuordnung: längere Strebe = links${stand.tauschen ? ' (VERTAUSCHT per --tauschen)' : ''}. Parameter strebenStartZ = ${prm.strebenStartZ} mm, lueckenBruecke = ${prm.lueckenBruecke} mm`);
  speichern(); txtSchreiben('1_streben');
  const m = meshAl(), ov = [];
  for (const s of SEITEN) { const v = st[s]; if (!v) continue; const pos = []; const stp = Math.max(1, Math.ceil(v.tri.length / 80000)); for (let i = 0; i < v.tri.length; i += stp) { const t = v.tri[i]; pos.push(m.cen[3 * t], m.cen[3 * t + 1], m.cen[3 * t + 2]); } ov.push({ art: 'punkte', pos, farbe: FARBE[s], groesse: 2 }); ov.push({ art: 'linie', pts: v.pfad, farbe: 0x111827 }); }
  await kontrollbild('1_streben', 'Schritt 1 – Streben: orange = links, blau = rechts, schwarz = Leitlinie', ov);
}
async function s2() {
  const st = streben(); stand.kamm = {}; delete stand.spline; delete stand.gemittelt;
  log(`SCHRITT 2 – Kammlinie (Schnittabstand ${prm.schnittAbstand} mm, Fenster ±${prm.suchRadius} mm)`);
  for (const s of SEITEN) {
    if (!st[s]) continue;
    const k = K.kammZweiPass(meshAl(), st[s], prm);
    stand.kamm[s] = k.map(q => ({ s: q.s, ok: q.ok, grund: q.grund || undefined, p: q.p, b: q.b, quer: q.quer, hoehe: q.hoehe, breite: q.breite, leit: q.leit, tan: q.tan, abw: q.abw }));
    const n = {}; k.forEach(q => { const g = q.ok ? 'ok' : q.grund; n[g] = (n[g] || 0) + 1; });
    const ok = k.filter(q => q.ok), h = ok.map(q => q.hoehe).sort((a, b) => a - b), b = ok.map(q => q.breite).sort((a, b) => a - b);
    log(`${s.padEnd(6)}: ${k.length} Schnitte · Kamm ${n.ok || 0} · Loch ${n.loch || 0} · Ausreißer ${n.ausreisser || 0} · unvollständig ${n.unvollstaendig || 0} · Fehlform ${(n.fehlform || 0) + (n.flach || 0)}`);
    log(`        Wulsthöhe Median ${f2(h[h.length >> 1])} mm (${f2(h[0])} … ${f2(h[h.length - 1])}) · Breite auf halber Höhe Median ${f2(b[b.length >> 1])} mm`);
    const csv = ['s_mm;gueltig;grund;x;y;z;hoehe_mm'].concat(k.map(q => [q.s, q.ok ? 1 : 0, q.grund || '', ...(q.ok ? q.p.map(v => v.toFixed(3)) : ['', '', '']), q.ok ? q.hoehe.toFixed(2) : ''].join(';')));
    fs.writeFileSync(path.join(ORD, `kammpunkte_${s}.csv`), csv.join('\r\n') + '\r\n');
  }
  speichern(); txtSchreiben('2_kamm');
  await kontrollbild('2_kamm', 'Schritt 2 – Kammpunkte: grün = Kamm, grau = Loch, rot = Ausreißer, gelb = unklar', SEITEN.filter(s => stand.kamm[s]).map(s => kammOverlay(stand.kamm[s])));
}
async function s3() {
  if (!stand.kamm) { console.error('Erst Schritt 2'); process.exit(1); }
  if (opt.modus) stand.modus = opt.modus;
  const modus = stand.modus || 'ausgleich';
  stand.spline = {}; stand.stuetz = {}; delete stand.gemittelt;
  log(`SCHRITT 3 – Spline (${modus === 'stuetz' ? 'durch Stützpunkte' : 'Ausgleichsspline'}) · Glättung ${prm.glaettung} → Glättungslänge ${K.glaettungsLaenge(prm.glaettung).toFixed(0)} mm · ${prm.kontrollpunkte} Kontrollpunkte · ${prm.stuetzpunkte} Stützpunkte`);
  for (const s of SEITEN) {
    const k = stand.kamm[s]; if (!k) continue;
    const ok = k.filter(q => q.ok);
    const aus = K.ausgleichSpline(ok.map(q => q.p), prm);
    const vor = K.stuetzpunkteVorschlagen(k, prm, aus);
    stand.stuetz[s] = vor.map(v => v.p);
    stand.spline[s] = modus === 'stuetz' ? K.interpolSpline(stand.stuetz[s]) : aus;
    const a = K.abweichung(stand.spline[s], k), L = K.bogenlaengen(K.bsSample(stand.spline[s], 800)).pop();
    log(`${s.padEnd(6)}: Länge ${L.toFixed(0)} mm · Kamm ↔ Spline max +${f2(a.max.wert)} / ${f2(a.min.wert)} mm · RMS ${f2(a.rms)} mm`);
    log(`        Stützpunkt-Vorschlag (ungestörteste Stellen): ` + vor.map(v => `s=${v.s.toFixed(0)} (Störung ${v.stoerung.toFixed(2)})`).join(', '));
  }
  speichern(); txtSchreiben('3_spline');
  const ov = []; for (const s of SEITEN) if (stand.spline[s]) { ov.push(kammOverlay(stand.kamm[s])); ov.push(splineOverlay(stand.spline[s], FARBE[s])); ov.push({ art: 'punkte', pos: stand.stuetz[s].flat(), farbe: 0x111827, groesse: 11 }); }
  await kontrollbild('3_spline', `Schritt 3 – Spline (${modus}) · Glättungslänge ${K.glaettungsLaenge(prm.glaettung).toFixed(0)} mm · schwarz = vorgeschlagene Stützpunkte`, ov);
}
async function s4() {
  if (!stand.spline || !stand.spline.links || !stand.spline.rechts) { console.error('Erst Schritt 3 (beide Seiten)'); process.exit(1); }
  if (opt.original) delete stand.gemittelt;
  const sym = K.symmetrie(stand.spline.links, stand.spline.rechts, prm), st = sym.stat;
  log('SCHRITT 4 – Symmetrie (rechts an X=0 gespiegelt, nur gemeinsamer Bereich)');
  log(`Vergleichsbereich: s = ${st.von.toFixed(0)} … ${st.bis.toFixed(0)} mm (links ${st.laengeL.toFixed(0)} mm, rechts ${st.laengeR.toFixed(0)} mm) – nichts abgeschnitten`);
  log(`Abweichung: max ${f2(st.max)} mm bei Z ${f2(sym.maxAt.p[2])} · mittel ${f2(st.mittel)} · RMS ${f2(st.rms)} mm`);
  if (opt.mitteln) {
    const gm = K.gemittelt(stand.spline.links, stand.spline.rechts, prm);
    stand.gemittelt = { links: gm.links, rechts: gm.rechts };
    log(`→ Gemittelter Spline aktiv (beide Seiten, volle Länge ${K.bogenlaengen(K.bsSample(gm.links, 800)).pop().toFixed(0)} mm). Zurück: --original`);
  }
  stand.symmetrie = st; speichern(); txtSchreiben('4_symmetrie');
  const ov = [splineOverlay(stand.spline.links, FARBE.links), splineOverlay(stand.spline.rechts, FARBE.rechts), { art: 'linie', pts: K.bsSample(K.splineSpiegeln(stand.spline.rechts), 300), farbe: 0x0369a1, strich: true }, { art: 'kugel', p: sym.maxAt.p, r: 14, farbe: 0xdc2626 }];
  if (stand.gemittelt) SEITEN.forEach(s => ov.push(splineOverlay(stand.gemittelt[s], FARBE.gemittelt)));
  await kontrollbild('4_symmetrie', `Schritt 4 – Symmetrie: max ${f2(st.max)} mm (roter Punkt) · gestrichelt = rechts gespiegelt${stand.gemittelt ? ' · violett = gemittelt' : ''}`, ov);
}
async function s5() {
  if (!stand.spline) { console.error('Erst Schritt 3'); process.exit(1); }
  log(`SCHRITT 5 – Kontrolle Spline ↔ Scan-Kamm (+ = Beule/rot, − = Delle/blau)${stand.gemittelt ? ' · gemittelter Spline' : ''}`);
  const abw = {}; let sk = prm.farbSkalaMm;
  for (const s of SEITEN) if (splineAktiv(s) && stand.kamm[s]) abw[s] = K.abweichung(splineAktiv(s), stand.kamm[s]);
  if (!(sk > 0)) { sk = 0.5; for (const a of Object.values(abw)) if (a.max) sk = Math.max(sk, Math.abs(a.max.wert), Math.abs(a.min.wert)); sk = Math.ceil(sk * 10) / 10; }
  for (const [s, a] of Object.entries(abw)) {
    log(`${s.padEnd(6)}: Beule max +${f2(a.max.wert)} mm (s ${a.max.sSpline.toFixed(0)} mm, Z ${f2(a.max.p[2])}) · Delle max ${f2(a.min.wert)} mm (s ${a.min.sSpline.toFixed(0)} mm, Z ${f2(a.min.p[2])}) · RMS ${f2(a.rms)} mm`);
    const csv = ['s_spline_mm;abweichung_mm;x;y;z'].concat(a.werte.map(w => [w.sSpline.toFixed(1), w.wert.toFixed(3), ...w.p.map(v => v.toFixed(2))].join(';')));
    fs.writeFileSync(path.join(ORD, `abweichung_${s}.csv`), csv.join('\r\n') + '\r\n');
  }
  log(`Farbskala ±${sk} mm`);
  txtSchreiben('5_abweichung');
  const ov = [], dia = [];
  for (const [s, a] of Object.entries(abw)) {
    ov.push(kammOverlay(stand.kamm[s], a, sk));
    const w = a.werte.slice().sort((x, y) => x.t - y.t), farben = [];
    for (let i = 0; i <= 300; i++) { const t = i / 300; let j = 0; while (j < w.length - 1 && w[j + 1].t < t) j++; farben.push(w.length && t >= w[0].t - 0.01 && t <= w[w.length - 1].t + 0.01 ? K.farbe(w[j].wert, sk) : [0.6, 0.6, 0.6]); }
    ov.push(splineOverlay(splineAktiv(s), 0, farben));
    dia.push({ name: s, L: a.laenge, w: a.werte.map(x => [x.sSpline, x.wert, K.farbe(x.wert, sk)]) });
  }
  await kontrollbild('5_abweichung', `Schritt 5 – Abweichung Kamm ↔ Spline: rot = Beule, blau = Delle (±${sk} mm) · Diagramm unten über der Bogenlänge`, ov, { diagramm: dia, skala: sk });
}
async function s6() {
  if (!stand.spline) { console.error('Erst Schritt 3'); process.exit(1); }
  const akt = {}; SEITEN.forEach(s => { if (splineAktiv(s)) akt[s] = splineAktiv(s); });
  const inv = K.M4.invRigid(stand.matrix), scanSys = {}; for (const [s, sp] of Object.entries(akt)) scanSys[s] = K.inSystem(sp, inv);
  const basis = path.join(ORD, 'leitkurven');
  const json = {
    format: 'v3d-strebe-spline', version: 1, datum: new Date().toISOString(), scan: path.basename(stand.scan), ausgerichteter_scan: stand.aligned ? path.basename(stand.aligned) : null,
    koordinaten: 'ausgerichtet (Fahrzeugmitte X=0, Spitze im Ursprung, Z oben, mm)', parameter: prm, modus: stand.gemittelt ? 'gemittelt' : (stand.modus || 'ausgleich'),
    ausrichtung: { matrix_scan_zu_ausgerichtet: stand.matrix, ...stand.ausrichtung },
    splines: akt, splines_ausgerichtet: akt, splines_scan: scanSys, stuetzpunkte_ausgerichtet: stand.stuetz || null, symmetrie: stand.symmetrie || null,
    kamm: stand.kamm,
  };
  fs.writeFileSync(basis + '.json', K.exportJSON(json));
  fs.writeFileSync(basis + '_stuetzpunkte.csv', K.exportCSV(stand.gemittelt || stand.modus !== 'stuetz' ? akt : Object.fromEntries(Object.entries(akt).map(([s, sp]) => [s, Object.assign({}, sp, { stuetz: stand.stuetz[s] })]))));
  fs.writeFileSync(basis + '.step', K.exportSTEP(akt, { name: 'leitkurven.step', beschreibung: 'Leitkurven Streben, ausgerichtet' }));
  fs.writeFileSync(basis + '_scan.step', K.exportSTEP(scanSys, { name: 'leitkurven_scan.step', beschreibung: 'Leitkurven Streben, Koordinaten Original-Scan' }));
  fs.writeFileSync(basis + '_polylinie.csv', K.exportPolylinie(akt, 2));
  log('SCHRITT 6 – Export (' + (json.modus) + ')');
  for (const f of ['.json', '_stuetzpunkte.csv', '.step', '_scan.step', '_polylinie.csv']) log('  ' + basis + f);
  log('STEP = exakte B-Spline-Kurven (Grad 3, mm). leitkurven.step passt zu ' + (json.ausgerichteter_scan || 'dem ausgerichteten Scan') + ', leitkurven_scan.step zum Original.');
  log('In V3D CAD: ausgerichteten Scan importieren → 〰 Strebe→Spline → 📂 JSON laden → Stützpunkte per Maus ziehen.');
  txtSchreiben('6_export');
}
function params() {
  log('Parameter (strebenspline_stand.json, ändern mit --param name=wert):');
  for (const [k, v] of Object.entries(prm)) log(`  ${k.padEnd(20)} ${v}`);
}

const S = { 0: s0, 1: s1, 2: s2, 3: s3, 4: s4, 5: s5, 6: s6, params };
if (!S[schritt]) { console.error('Unbekannter Schritt', schritt); process.exit(1); }
await S[schritt]();
if (schritt !== 'params') console.log('\n→ Kontrollbild prüfen; bei OK nächsten Schritt aufrufen.');
