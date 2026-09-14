// V3D Scan – Oberfläche.
//
// Punktdaten liegen im Python-Dienst; hier wird nur angezeigt, gewählt und
// Befehle geschickt. Jeder Scan ist ein THREE.Points mit eigenem Shader:
//   farbe  = Anzeigefarbe je Punkt (aus Färbungsmodus)
//   mark   = 1 gewählt, 2 Vorschau „fällt weg“, 3 beides
// Auswahl „nur sichtbare Punkte“ vergleicht jeden Punkt mit einem
// Tiefenbild (eigener Render-Durchgang, linear gepackt in RGBA8).

import * as THREE from 'three';
import { OrbitControls } from './lib/OrbitControls.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------
const S = {
  zustand: { scans: [] },
  scans: new Map(),        // id -> Eintrag (siehe scanAnlegen)
  aktiv: null,
  werkzeug: 'orbit',
  durch: false,
  farbModus: 'rgb',
  punktGroesse: 2,
  schattierung: true,
  oben: 'y',
  vorschau: null,          // {art:'bereinigen', werkzeug, parameter}
  ebenePunkte: [],         // Schnittebene: bis zu 3 Weltpunkte
  ebeneUmdrehen: false,
  pickModus: null,         // 'ebene3' | 'paare' | null
  paare: [],               // [{fest:[x,y,z], bewegt:[x,y,z]|null}]
  regMatrizen: null,       // {id: 4x4} Vorschau-Ausrichtung
  abweichung: null,        // {id, werte:Float32Array, max}
  beschaeftigt: false,
};

// ---------------------------------------------------------------------------
// Dienst
// ---------------------------------------------------------------------------
async function api(name, daten = {}, text = null) {
  return mitSanduhr(text, async () => {
    const r = await fetch('/api/' + name, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(daten),
    });
    const j = await r.json().catch(() => ({ fehler: 'Ungültige Antwort vom Dienst.' }));
    if (!r.ok || j.fehler) throw new Error(j.fehler || ('HTTP ' + r.status));
    if (j.zustand) await zustandUebernehmen(j.zustand);
    return j;
  });
}

async function mitSanduhr(text, fn) {
  if (!text) return fn();
  const start = performance.now();
  S.beschaeftigt = true;
  $('#beschaeftigt').hidden = false;
  const uhr = setInterval(() => {
    $('#beschaeftigtText').textContent = `${text} ${((performance.now() - start) / 1000).toFixed(0)} s`;
  }, 500);
  $('#beschaeftigtText').textContent = text;
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  try {
    return await fn();
  } finally {
    clearInterval(uhr);
    S.beschaeftigt = false;
    $('#beschaeftigt').hidden = true;
  }
}

function meldung(text, art = '') {
  const el = document.createElement('div');
  el.className = 'meldung ' + art;
  el.textContent = text;
  $('#meldungen').appendChild(el);
  setTimeout(() => el.remove(), art === 'fehler' ? 7000 : 3500);
}

function status(text) { $('#statusText').textContent = text; }

async function sicher(fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    meldung(e.message || String(e), 'fehler');
  }
}

const b64 = {
  maske(bytesB64, n) {
    const bin = atob(bytesB64);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1;
    return out;
  },
  ausMaske(m) {
    const bytes = new Uint8Array((m.length + 7) >> 3);
    for (let i = 0; i < m.length; i++) if (m[i]) bytes[i >> 3] |= 1 << (i & 7);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  float32(text) {
    const bin = atob(text);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Float32Array(u.buffer);
  },
};

// ---------------------------------------------------------------------------
// Szene
// ---------------------------------------------------------------------------
const leinwand = $('#leinwand');
const renderer = new THREE.WebGLRenderer({ canvas: leinwand, antialias: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x16191e);
const szene = new THREE.Scene();
const kamera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
kamera.position.set(0, 150, 400);
const steuerung = new OrbitControls(kamera, leinwand);
steuerung.enableDamping = false;
steuerung.zoomToCursor = true;
const hilfsGruppe = new THREE.Group();
szene.add(hilfsGruppe);
let gitter = null;

const PUNKT_VS = `
  attribute vec3 farbe;
  attribute float mark;
  attribute vec3 normale;
  uniform float groesse;
  uniform float hatNormalen;
  uniform float schatten;
  varying vec3 vFarbe;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = groesse;
    vec3 c = farbe;
    if (hatNormalen > 0.5 && schatten > 0.5) {
      vec3 n = normalize(normalMatrix * normale);
      float l = abs(dot(n, normalize(-mv.xyz)));
      c *= 0.3 + 0.8 * l;
    }
    if (mark > 1.5) c = vec3(1.0, 0.18, 0.12);
    else if (mark > 0.5) c = mix(c, vec3(1.0, 0.62, 0.0), 0.8);
    vFarbe = c;
  }`;
const PUNKT_FS = `
  varying vec3 vFarbe;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    if (dot(p, p) > 1.0) discard;
    gl_FragColor = vec4(vFarbe, 1.0);
  }`;
const TIEFE_VS = `
  uniform float groesse;
  uniform float nah;
  uniform float fern;
  varying float vTiefe;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = groesse;
    vTiefe = clamp((-mv.z - nah) / (fern - nah), 0.0, 1.0);
  }`;
const TIEFE_FS = `
  varying float vTiefe;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    if (dot(p, p) > 1.0) discard;
    vec4 e = fract(vec4(1.0, 255.0, 65025.0, 16581375.0) * vTiefe);
    e -= e.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
    gl_FragColor = e;
  }`;
const tiefeMaterial = new THREE.ShaderMaterial({
  vertexShader: TIEFE_VS, fragmentShader: TIEFE_FS,
  uniforms: { groesse: { value: 2 }, nah: { value: 0.1 }, fern: { value: 1000 } },
});

function groesseUniform() { return S.punktGroesse * renderer.getPixelRatio(); }

// ---------------------------------------------------------------------------
// Scans
// ---------------------------------------------------------------------------
async function scanLaden(meta) {
  const r = await fetch('/api/punkte/' + meta.id);
  if (!r.ok) throw new Error('Punkte von Scan ' + meta.id + ' nicht ladbar');
  const puffer = await r.arrayBuffer();
  const kopf = new Uint32Array(puffer, 0, 2);
  const n = kopf[0], flags = kopf[1];
  let o = 8;
  const xyz = new Float32Array(puffer, o, n * 3); o += n * 12;
  let rgb = null, nrm = null;
  if (flags & 1) { rgb = new Uint8Array(puffer, o, n * 3); o += Math.ceil(n * 3 / 4) * 4; }
  if (flags & 2) { nrm = new Float32Array(puffer, o, n * 3); }

  let e = S.scans.get(meta.id);
  if (e) { szene.remove(e.obj); e.geo.dispose(); e.obj.material.dispose(); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(xyz, 3));
  const farbe = new Uint8Array(n * 3);
  geo.setAttribute('farbe', new THREE.BufferAttribute(farbe, 3, true));
  const mark = new Uint8Array(n);
  geo.setAttribute('mark', new THREE.BufferAttribute(mark, 1));
  // Ohne Normalen liest der Shader das Attribut nicht (hatNormalen=0), WebGL
  // verlangt aber trotzdem eines in voller Länge.
  geo.setAttribute('normale', new THREE.BufferAttribute(nrm || new Float32Array(n * 3), 3));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  const mat = new THREE.ShaderMaterial({
    vertexShader: PUNKT_VS, fragmentShader: PUNKT_FS,
    uniforms: {
      groesse: { value: groesseUniform() }, hatNormalen: { value: nrm ? 1 : 0 },
      schatten: { value: S.schattierung ? 1 : 0 },
    },
  });
  const obj = new THREE.Points(geo, mat);
  obj.matrixAutoUpdate = false;
  obj.userData.scanId = meta.id;
  szene.add(obj);
  e = { id: meta.id, meta, n, xyz, rgb, nrm, geo, obj, farbe, mark,
        sel: new Uint8Array(n), vor: new Uint8Array(n), rev: meta.rev };
  S.scans.set(meta.id, e);
  return e;
}

async function zustandUebernehmen(z) {
  const erstesMal = S.scans.size === 0;
  S.zustand = z;
  const ids = new Set(z.scans.map((s) => s.id));
  for (const [id, e] of S.scans) {
    if (!ids.has(id)) {
      szene.remove(e.obj); e.geo.dispose(); e.obj.material.dispose();
      S.scans.delete(id);
    }
  }
  let neuGeladen = false;
  for (const meta of z.scans) {
    const e = S.scans.get(meta.id);
    if (!e || e.rev !== meta.rev) {
      await scanLaden(meta);
      neuGeladen = true;
      if (S.abweichung && S.abweichung.id === meta.id) S.abweichung = null;
    } else {
      e.meta = meta;
    }
    S.scans.get(meta.id).obj.visible = meta.sichtbar;
  }
  if (neuGeladen) {
    // Geometrie geändert: alte Vorschauen passen nicht mehr.
    S.vorschau = null;
    for (const e of S.scans.values()) e.vor.fill(0);
    regZuruecksetzen(false);
  }
  if (!S.scans.has(S.aktiv)) S.aktiv = z.scans.length ? z.scans[z.scans.length - 1].id : null;
  alleFarbenSetzen();
  alleMarkierungen();
  listeZeichnen();
  auswahlListenFuellen();
  $('#knopfUndo').disabled = !z.undo;
  $('#knopfRedo').disabled = !z.redo;
  $('#knopfUndo').title = z.undo ? 'Rückgängig: ' + z.undo + ' (Strg+Z)' : 'Nichts rückgängig zu machen';
  $('#knopfRedo').title = z.redo ? 'Wiederholen: ' + z.redo + ' (Strg+Y)' : 'Nichts zu wiederholen';
  $('#leerHinweis').hidden = z.scans.length > 0;
  if (erstesMal && z.scans.length) einpassen();
  kameraGrenzen();
  punkteInfo();
}

function listeZeichnen() {
  const liste = $('#scanListe');
  liste.innerHTML = '';
  for (const meta of S.zustand.scans) {
    const el = document.createElement('div');
    el.className = 'scan' + (meta.id === S.aktiv ? ' aktiv' : '') + (meta.sichtbar ? '' : ' versteckt');
    el.innerHTML = `
      <button class="auge" title="Ein-/Ausblenden">${meta.sichtbar ? '👁' : '◌'}</button>
      <span class="punkt" style="background:${meta.farbe}"></span>
      <span class="name" title="Doppelklick zum Umbenennen"></span>
      <span class="rechts">
        ${meta.fest ? '<span class="fest-marke" title="Referenz beim Ausrichten">FEST</span>' : ''}
        <button class="weg" title="Scan entfernen">✕</button>
      </span>
      <span class="zahl">${meta.anzahl.toLocaleString('de-DE')} Punkte${meta.hat_farbe ? ' · Farbe' : ''}${meta.hat_normalen ? ' · Normalen' : ''}</span>`;
    el.querySelector('.name').textContent = meta.name;
    el.addEventListener('click', () => { S.aktiv = meta.id; listeZeichnen(); auswahlListenFuellen(); });
    el.querySelector('.auge').addEventListener('click', (ev) => {
      ev.stopPropagation();
      sicher(() => api('scan/setzen', { id: meta.id, sichtbar: !meta.sichtbar }));
    });
    el.querySelector('.weg').addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (confirm(`Scan „${meta.name}“ entfernen? (Rückgängig möglich)`)) sicher(() => api('scan/entfernen', { id: meta.id }));
    });
    el.querySelector('.name').addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      const name = prompt('Neuer Name:', meta.name);
      if (name) sicher(() => api('scan/setzen', { id: meta.id, name }));
    });
    liste.appendChild(el);
  }
  eigenschaftenZeichnen();
}

function eigenschaftenZeichnen() {
  const e = S.scans.get(S.aktiv);
  $('#eigenschaften').hidden = !e;
  if (!e) return;
  const bb = e.geo.boundingBox, groesse = bb.getSize(new THREE.Vector3()), mitte = bb.getCenter(new THREE.Vector3());
  const f = (v) => v.toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const zeilen = [
    ['Name', e.meta.name],
    ['Punkte', e.n.toLocaleString('de-DE')],
    ['Farbe / Normalen', `${e.rgb ? 'ja' : 'nein'} / ${e.nrm ? 'ja' : 'nein'}`],
    ['Größe X × Y × Z', `${f(groesse.x)} × ${f(groesse.y)} × ${f(groesse.z)} mm`],
    ['Mitte', `${f(mitte.x)} ; ${f(mitte.y)} ; ${f(mitte.z)}`],
  ];
  if (e.abstand) zeilen.push(['Punktabstand', `≈ ${e.abstand.toFixed(3)} mm`]);
  const tab = $('#eigenschaftenTabelle');
  tab.innerHTML = '';
  for (const [k, v] of zeilen) {
    const tr = tab.insertRow();
    tr.insertCell().textContent = k;
    tr.insertCell().textContent = v;
  }
}

function auswahlListenFuellen() {
  const scans = S.zustand.scans;
  for (const [sel, standard] of [['#wahlFest', 'fest'], ['#wahlBewegt', 'bewegt']]) {
    const el = $(sel);
    const alt = Number(el.value);
    el.innerHTML = scans.map((s) => `<option value="${s.id}"></option>`).join('');
    [...el.options].forEach((o, i) => { o.textContent = scans[i].name; });
    let wert = scans.some((s) => s.id === alt) ? alt : null;
    if (wert === null && scans.length) {
      const fest = scans.find((s) => s.fest) || scans[0];
      if (standard === 'fest') wert = fest.id;
      else wert = (scans.find((s) => s.id === S.aktiv && s.id !== fest.id) || scans.find((s) => s.id !== fest.id) || fest).id;
    }
    if (wert !== null) el.value = wert;
  }
}

function sichtbareScans() { return [...S.scans.values()].filter((e) => e.obj.visible); }

function zielIds() {
  const art = document.querySelector('input[name=ziel]:checked').value;
  if (art === 'sichtbar') return sichtbareScans().map((e) => e.id);
  return S.aktiv ? [S.aktiv] : [];
}

// ---------------------------------------------------------------------------
// Färbung
// ---------------------------------------------------------------------------
const TURBO = [[48, 18, 59], [70, 134, 251], [27, 229, 181], [164, 252, 60], [251, 185, 56], [228, 70, 11], [122, 4, 3]];
function farbskala(t, aus, o) {
  t = Math.min(1, Math.max(0, t)) * (TURBO.length - 1);
  const i = Math.min(TURBO.length - 2, Math.floor(t));
  const f = t - i;
  for (let k = 0; k < 3; k++) aus[o + k] = TURBO[i][k] + (TURBO[i + 1][k] - TURBO[i][k]) * f;
}

function hexZuRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function alleFarbenSetzen() {
  const achse = S.oben === 'z' ? 2 : 1;
  let min = Infinity, max = -Infinity;
  if (S.farbModus === 'hoehe') {
    for (const e of sichtbareScans()) {
      const bb = e.geo.boundingBox;
      min = Math.min(min, bb.min.getComponent(achse));
      max = Math.max(max, bb.max.getComponent(achse));
    }
  }
  for (const e of S.scans.values()) farbenSetzen(e, min, max, achse);
  legendeZeichnen();
}

function farbenSetzen(e, min, max, achse) {
  const f = e.farbe, n = e.n;
  const eigen = hexZuRgb(e.meta.farbe);
  const abw = S.abweichung && S.abweichung.id === e.id ? S.abweichung : null;
  if (abw) {
    const grau = 110;
    for (let i = 0; i < n; i++) {
      const w = abw.werte[i];
      if (w > abw.max * 1.5) { f[i * 3] = f[i * 3 + 1] = f[i * 3 + 2] = grau; } else farbskala(w / abw.max, f, i * 3);
    }
  } else if (S.farbModus === 'rgb' && e.rgb) {
    f.set(e.rgb);
  } else if (S.farbModus === 'hoehe') {
    const spanne = Math.max(1e-6, max - min);
    for (let i = 0; i < n; i++) farbskala((e.xyz[i * 3 + achse] - min) / spanne, f, i * 3);
  } else if (S.farbModus === 'normalen' && e.nrm) {
    for (let i = 0; i < n * 3; i++) f[i] = (e.nrm[i] * 0.5 + 0.5) * 255;
  } else {
    for (let i = 0; i < n; i++) { f[i * 3] = eigen[0]; f[i * 3 + 1] = eigen[1]; f[i * 3 + 2] = eigen[2]; }
  }
  e.geo.getAttribute('farbe').needsUpdate = true;
  e.obj.material.uniforms.schatten.value = S.schattierung && S.farbModus !== 'normalen' ? 1 : 0;
}

function legendeZeichnen() {
  const el = $('#legende');
  if (!S.abweichung) { el.hidden = true; return; }
  const stops = TURBO.map((c, i) => `rgb(${c}) ${(i / (TURBO.length - 1) * 100).toFixed(0)}%`).join(',');
  const a = S.abweichung;
  el.hidden = false;
  el.innerHTML = `<div>Abweichung zum festen Scan</div>
    <div class="balken" style="background:linear-gradient(90deg,${stops})"></div>
    <div class="skala"><span>0</span><span>${(a.max / 2).toFixed(2)}</span><span>${a.max.toFixed(2)} mm</span></div>
    <div>Median ${a.median.toFixed(3)} mm · 95 % unter ${a.p95.toFixed(3)} mm<br><small>grau = weiter als ${(a.max * 1.5).toFixed(2)} mm (kein Gegenstück)</small></div>`;
}

// ---------------------------------------------------------------------------
// Markierungen (Auswahl + Vorschau)
// ---------------------------------------------------------------------------
function markierungSetzen(e) {
  const m = e.mark, s = e.sel, v = e.vor;
  for (let i = 0; i < e.n; i++) m[i] = s[i] | (v[i] << 1);
  e.geo.getAttribute('mark').needsUpdate = true;
}
function alleMarkierungen() { for (const e of S.scans.values()) markierungSetzen(e); punkteInfo(); }

function punkteInfo() {
  let gesamt = 0, gewaehlt = 0, vor = 0;
  for (const e of S.scans.values()) {
    if (!e.obj.visible) continue;
    gesamt += e.n;
    for (let i = 0; i < e.n; i++) { gewaehlt += e.sel[i]; vor += e.vor[i]; }
  }
  $('#punkteInfo').textContent = `${gesamt.toLocaleString('de-DE')} Punkte sichtbar`;
  $('#auswahlInfo').textContent = gewaehlt ? `${gewaehlt.toLocaleString('de-DE')} Punkte gewählt` : 'Nichts gewählt.';
  if (vor) status(`Vorschau: ${vor.toLocaleString('de-DE')} Punkte fallen weg (rot). „Anwenden“ löscht sie.`);
}

function auswahlMasken() {
  const masken = {};
  for (const e of S.scans.values()) {
    if (!e.obj.visible) continue;
    let irgendwas = false;
    for (let i = 0; i < e.n; i++) if (e.sel[i]) { irgendwas = true; break; }
    if (irgendwas) masken[e.id] = b64.ausMaske(e.sel);
  }
  return masken;
}

// ---------------------------------------------------------------------------
// Kamera
// ---------------------------------------------------------------------------
function szenenKugel() {
  const box = new THREE.Box3();
  for (const e of sichtbareScans()) if (e.n) box.union(e.geo.boundingBox.clone().applyMatrix4(e.obj.matrix));
  if (box.isEmpty()) return new THREE.Sphere(new THREE.Vector3(), 100);
  return box.getBoundingSphere(new THREE.Sphere());
}

function kameraGrenzen() {
  const k = szenenKugel();
  const abstand = kamera.position.distanceTo(k.center);
  kamera.near = Math.max(0.01, Math.min(k.radius / 500, (abstand - k.radius) * 0.5));
  kamera.far = abstand + k.radius * 4;
  kamera.updateProjectionMatrix();
}

function obenVektor() { return S.oben === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0); }

function blick(richtung) {
  const k = szenenKugel();
  const oben = obenVektor();
  kamera.up.copy(richtung.clone().normalize().dot(oben) > 0.99 ? (S.oben === 'z' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, -1)) : oben);
  const dist = k.radius / Math.sin(THREE.MathUtils.degToRad(kamera.fov / 2)) * 1.1;
  kamera.position.copy(k.center).addScaledVector(richtung.clone().normalize(), dist);
  steuerung.target.copy(k.center);
  kamera.lookAt(k.center);
  steuerung.update();
  kameraGrenzen();
  gitterSetzen(k);
}

function achsenRichtung(name) {
  const z = S.oben === 'z';
  switch (name) {
    case 'vorne': return z ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, 1);
    case 'oben': return z ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    case 'rechts': return new THREE.Vector3(1, 0, 0);
    default: return z ? new THREE.Vector3(1, -1, 0.8) : new THREE.Vector3(1, 0.8, 1);
  }
}

function einpassen() {
  const k = szenenKugel();
  const richtung = kamera.position.clone().sub(steuerung.target);
  if (richtung.lengthSq() < 1e-9) richtung.copy(achsenRichtung('iso'));
  const dist = k.radius / Math.sin(THREE.MathUtils.degToRad(kamera.fov / 2)) * 1.1;
  steuerung.target.copy(k.center);
  kamera.position.copy(k.center).addScaledVector(richtung.normalize(), dist);
  steuerung.update();
  kameraGrenzen();
  gitterSetzen(k);
}

function gitterSetzen(k) {
  if (gitter) { szene.remove(gitter); gitter.geometry.dispose(); gitter.material.dispose(); }
  const groesse = Math.pow(10, Math.ceil(Math.log10(k.radius * 3)));
  gitter = new THREE.GridHelper(groesse, 20, 0x3a4350, 0x262c35);
  if (S.oben === 'z') gitter.rotation.x = Math.PI / 2;
  const unten = new THREE.Box3();
  for (const e of sichtbareScans()) unten.union(e.geo.boundingBox);
  const o = obenVektor();
  if (!unten.isEmpty()) gitter.position.copy(k.center).sub(o.clone().multiplyScalar(k.center.dot(o) - unten.min.dot(o)));
  szene.add(gitter);
}

function groesseAnpassen() {
  const w = leinwand.clientWidth, h = leinwand.clientHeight;
  renderer.setSize(w, h, false);
  kamera.aspect = w / Math.max(1, h);
  kamera.updateProjectionMatrix();
  $('#zeichnung').setAttribute('viewBox', `0 0 ${w} ${h}`);
}
new ResizeObserver(groesseAnpassen).observe(leinwand);

function zeichnen() {
  requestAnimationFrame(zeichnen);
  const g = groesseUniform();
  for (const e of S.scans.values()) e.obj.material.uniforms.groesse.value = g;
  markerGroesse();
  renderer.render(szene, kamera);
  achsenZeichnen();
}

const achsenSvg = $('#achsen');
let achsenAlt = '';
function achsenZeichnen() {
  const q = kamera.quaternion.clone().invert();
  const achsen = [['X', new THREE.Vector3(1, 0, 0), '#e0584f'], ['Y', new THREE.Vector3(0, 1, 0), '#5cbf6a'], ['Z', new THREE.Vector3(0, 0, 1), '#3d9be9']]
    .map(([n, v, c]) => [n, v.applyQuaternion(q), c]).sort((a, b) => a[1].z - b[1].z);
  const svg = achsen.map(([n, v, c]) => {
    const x = v.x * 26, y = -v.y * 26;
    return `<line x1="0" y1="0" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`
      + `<circle cx="${(x * 1.2).toFixed(1)}" cy="${(y * 1.2).toFixed(1)}" r="7" fill="${c}"/>`
      + `<text x="${(x * 1.2).toFixed(1)}" y="${(y * 1.2 + 3.5).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="bold" fill="#111">${n}</text>`;
  }).join('');
  if (svg !== achsenAlt) { achsenSvg.innerHTML = svg; achsenAlt = svg; }
}

// ---------------------------------------------------------------------------
// Projektion / Tiefenbild / Picking
// ---------------------------------------------------------------------------
function tiefenbild() {
  const w = renderer.domElement.width, h = renderer.domElement.height;
  const ziel = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
  tiefeMaterial.uniforms.groesse.value = groesseUniform();
  tiefeMaterial.uniforms.nah.value = kamera.near;
  tiefeMaterial.uniforms.fern.value = kamera.far;
  const altHilfe = hilfsGruppe.visible, altGitter = gitter ? gitter.visible : false;
  hilfsGruppe.visible = false; if (gitter) gitter.visible = false;
  szene.overrideMaterial = tiefeMaterial;
  const altFarbe = renderer.getClearColor(new THREE.Color()), altAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0xffffff, 1);
  renderer.setRenderTarget(ziel);
  renderer.clear();
  renderer.render(szene, kamera);
  const pixel = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(ziel, 0, 0, w, h, pixel);
  renderer.setRenderTarget(null);
  renderer.setClearColor(altFarbe, altAlpha);
  szene.overrideMaterial = null;
  hilfsGruppe.visible = altHilfe; if (gitter) gitter.visible = altGitter;
  ziel.dispose();
  const tiefe = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    tiefe[i] = pixel[o] / 255 + pixel[o + 1] / 65025 + pixel[o + 2] / 16581375 + pixel[o + 3] / 4228250625;
  }
  return { tiefe, w, h };
}

// Ruft fn(e, i, px, py, tiefeLinear) für jeden sichtbaren Punkt auf dem Bildschirm auf.
function jederPunkt(fn, nurScan = null) {
  const W = renderer.domElement.width, H = renderer.domElement.height;
  const vp = new THREE.Matrix4();
  kamera.updateMatrixWorld();
  const nah = kamera.near, fern = kamera.far;
  for (const e of S.scans.values()) {
    if (!e.obj.visible || (nurScan !== null && e.id !== nurScan)) continue;
    vp.multiplyMatrices(kamera.projectionMatrix, kamera.matrixWorldInverse).multiply(e.obj.matrix);
    const mv = new THREE.Matrix4().multiplyMatrices(kamera.matrixWorldInverse, e.obj.matrix).elements;
    const m = vp.elements, p = e.xyz;
    for (let i = 0; i < e.n; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (cw <= 0) continue;
      const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw;
      const cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw;
      if (cx < -1 || cx > 1 || cy < -1 || cy > 1) continue;
      const vz = mv[2] * x + mv[6] * y + mv[10] * z + mv[14];
      fn(e, i, (cx * 0.5 + 0.5) * W, (cy * 0.5 + 0.5) * H, (-vz - nah) / (fern - nah));
    }
  }
}

function tiefenToleranz(tiefeLinear) {
  // Größe eines Punkt-Sprites in Weltmaß an dieser Stelle, als lineare Tiefe.
  const dist = kamera.near + tiefeLinear * (kamera.far - kamera.near);
  const proPixel = 2 * dist * Math.tan(THREE.MathUtils.degToRad(kamera.fov / 2)) / renderer.domElement.height;
  return (proPixel * groesseUniform() * 2.5 + dist * 0.002) / (kamera.far - kamera.near);
}

// Nächster sichtbarer Punkt um die Mausposition (CSS-Pixel).
function punktAn(cssX, cssY, nurScan = null) {
  const pr = renderer.getPixelRatio();
  const mx = cssX * pr, my = renderer.domElement.height - cssY * pr;
  const radius = 9 * pr;
  let best = null;
  jederPunkt((e, i, px, py, t) => {
    const dx = px - mx, dy = py - my;
    if (dx * dx + dy * dy > radius * radius) return;
    const wert = t + Math.sqrt(dx * dx + dy * dy) / radius * 1e-4;
    if (!best || wert < best.wert) best = { e, i, wert };
  }, nurScan);
  if (!best) return null;
  const v = new THREE.Vector3(best.e.xyz[best.i * 3], best.e.xyz[best.i * 3 + 1], best.e.xyz[best.i * 3 + 2]);
  return { id: best.e.id, index: best.i, lokal: v.clone(), welt: v.applyMatrix4(best.e.obj.matrix) };
}

// ---------------------------------------------------------------------------
// Auswahl-Werkzeuge
// ---------------------------------------------------------------------------
const zeichnung = $('#zeichnung');
let zug = null; // laufender Rechteck-/Lassozug

function werkzeugSetzen(w) {
  S.werkzeug = w;
  if (w !== 'orbit') pickModusSetzen(null);
  $$('[data-werkzeug]').forEach((b) => b.classList.toggle('an', b.dataset.werkzeug === w));
  if (zug) { zug = null; zeichnung.innerHTML = ''; }
  const auswahl = w === 'rechteck' || w === 'lasso' || w === 'polygon';
  steuerung.mouseButtons = { LEFT: auswahl || w === 'verbunden' ? null : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  leinwand.style.cursor = auswahl ? 'crosshair' : w === 'verbunden' ? 'pointer' : 'grab';
  const tipps = {
    orbit: 'Drehen: linke/rechte Maustaste · Verschieben: mittlere · Zoom: Rad',
    rechteck: 'Rechteck aufziehen = hinzufügen · Strg = abwählen',
    lasso: 'Lasso zeichnen = hinzufügen · Strg = abwählen',
    polygon: 'Ecken anklicken · Doppelklick oder Enter schließt · Rücktaste nimmt letzte Ecke zurück · Strg = abwählen',
    verbunden: 'Punkt anklicken: alles damit Zusammenhängende wird gewählt · Strg = abwählen',
  };
  status(tipps[w]);
}

function durchSetzen(an) {
  S.durch = an;
  $('#durchWahl').checked = an;
  $('#knopfDurch').classList.toggle('an', an);
}

function lokalePos(ev) {
  const r = leinwand.getBoundingClientRect();
  return [ev.clientX - r.left, ev.clientY - r.top];
}

leinwand.addEventListener('pointerdown', (ev) => {
  if (S.beschaeftigt || ev.button !== 0) return;
  const [x, y] = lokalePos(ev);
  if (S.pickModus) { ev.preventDefault(); pickKlick(x, y); return; }
  if (S.werkzeug === 'verbunden') { verbundenKlick(x, y, ev.ctrlKey || ev.metaKey); return; }
  if (S.werkzeug === 'polygon') {
    if (!zug) zug = { art: 'polygon', punkte: [], weg: ev.ctrlKey || ev.metaKey };
    const l = zug.punkte[zug.punkte.length - 1];
    if (!l || Math.hypot(x - l[0], y - l[1]) > 4) zug.punkte.push([x, y]);
    zug.maus = [x, y];
    zugZeichnen();
    return;
  }
  if (S.werkzeug !== 'rechteck' && S.werkzeug !== 'lasso') return;
  leinwand.setPointerCapture(ev.pointerId);
  zug = { art: S.werkzeug, punkte: [[x, y]], weg: ev.ctrlKey || ev.metaKey };
  zugZeichnen();
});
leinwand.addEventListener('pointermove', (ev) => {
  if (!zug) return;
  const [x, y] = lokalePos(ev);
  if (zug.art === 'polygon') { zug.maus = [x, y]; zugZeichnen(); return; }
  if (zug.art === 'rechteck') zug.punkte[1] = [x, y];
  else {
    const l = zug.punkte[zug.punkte.length - 1];
    if (Math.hypot(x - l[0], y - l[1]) > 3) zug.punkte.push([x, y]);
  }
  zugZeichnen();
});
leinwand.addEventListener('dblclick', () => polygonSchliessen());

function polygonSchliessen() {
  if (!zug || zug.art !== 'polygon') return false;
  const z = zug;
  zug = null;
  zeichnung.innerHTML = '';
  if (z.punkte.length >= 3) auswahlAnwenden(z);
  else status('Polygon braucht mindestens 3 Ecken.');
  return true;
}

leinwand.addEventListener('pointerup', () => {
  if (!zug || zug.art === 'polygon') return;
  const z = zug;
  zug = null;
  zeichnung.innerHTML = '';
  if (z.art === 'rechteck' && z.punkte.length < 2) return;
  if (z.art === 'lasso' && z.punkte.length < 3) return;
  auswahlAnwenden(z);
});

function zugZeichnen() {
  const p = zug.punkte;
  const farbe = zug.weg ? '#e0584f' : '#3d9be9';
  if (zug.art === 'rechteck') {
    if (p.length < 2) { zeichnung.innerHTML = ''; return; }
    const x = Math.min(p[0][0], p[1][0]), y = Math.min(p[0][1], p[1][1]);
    zeichnung.innerHTML = `<rect x="${x}" y="${y}" width="${Math.abs(p[1][0] - p[0][0])}" height="${Math.abs(p[1][1] - p[0][1])}" fill="${farbe}22" stroke="${farbe}" stroke-dasharray="5 3"/>`;
  } else if (zug.art === 'polygon') {
    const alle = zug.maus ? [...p, zug.maus] : p;
    zeichnung.innerHTML = `<polygon points="${alle.map((q) => q.join(',')).join(' ')}" fill="${farbe}22" stroke="${farbe}" stroke-dasharray="5 3"/>`
      + p.map((q) => `<circle cx="${q[0]}" cy="${q[1]}" r="3.5" fill="${farbe}"/>`).join('');
  } else {
    zeichnung.innerHTML = `<polygon points="${p.map((q) => q.join(',')).join(' ')}" fill="${farbe}22" stroke="${farbe}" stroke-dasharray="5 3"/>`;
  }
}

function auswahlAnwenden(z) {
  const pr = renderer.getPixelRatio();
  const W = renderer.domElement.width, H = renderer.domElement.height;
  // Form als Maske auf Pixelgröße der Zeichenfläche rastern.
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.scale(pr, pr);
  g.beginPath();
  if (z.art === 'rechteck') {
    const [a, b] = z.punkte;
    g.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  } else {
    z.punkte.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
    g.closePath();
  }
  g.fill();
  const form = g.getImageData(0, 0, W, H).data;
  const tb = S.durch ? null : tiefenbild();
  const wert = z.weg ? 0 : 1;
  let anzahl = 0;
  jederPunkt((e, i, px, py, t) => {
    const ix = px | 0, iy = py | 0;
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
    if (!form[((H - 1 - iy) * W + ix) * 4 + 3]) return;
    if (tb) {
      const vorne = tb.tiefe[iy * W + ix];
      if (t - vorne > tiefenToleranz(t)) return;
    }
    if (e.sel[i] !== wert) { e.sel[i] = wert; anzahl++; }
  });
  alleMarkierungen();
  status(`${z.weg ? 'Abgewählt' : 'Gewählt'}: ${anzahl.toLocaleString('de-DE')} Punkte${S.durch ? ' (durch das Modell)' : ' (nur sichtbare)'}`);
}

async function verbundenKlick(x, y, weg) {
  const p = punktAn(x, y);
  if (!p) { status('Kein Punkt unter der Maus.'); return; }
  await sicher(async () => {
    const j = await api('auswahl/verbunden', { id: p.id, index: p.index, abstand: Number($('#verbundenAbstand').value) }, 'Suche Zusammenhang…');
    const e = S.scans.get(p.id);
    const m = b64.maske(j.maske, e.n);
    let anzahl = 0;
    for (let i = 0; i < e.n; i++) if (m[i]) { e.sel[i] = weg ? 0 : 1; anzahl++; }
    alleMarkierungen();
    status(`${anzahl.toLocaleString('de-DE')} zusammenhängende Punkte ${weg ? 'abgewählt' : 'gewählt'}.`);
  });
}

function auswahlAlle(wert) {
  for (const e of sichtbareScans()) e.sel.fill(wert);
  alleMarkierungen();
}
function auswahlUmkehren() {
  for (const e of sichtbareScans()) for (let i = 0; i < e.n; i++) e.sel[i] ^= 1;
  alleMarkierungen();
}

async function auswahlLoeschen() {
  const masken = auswahlMasken();
  if (!Object.keys(masken).length) { meldung('Nichts gewählt.'); return; }
  const j = await api('auswahl/loeschen', { masken }, 'Lösche…');
  meldung(`${j.geloescht.toLocaleString('de-DE')} Punkte gelöscht.`, 'ok');
}

async function auswahlAbtrennen() {
  const masken = auswahlMasken();
  if (!Object.keys(masken).length) { meldung('Nichts gewählt.'); return; }
  const j = await api('auswahl/abtrennen', { masken }, 'Trenne ab…');
  if (j.neu) { S.aktiv = j.neu; listeZeichnen(); }
  meldung('Auswahl als neuer Scan abgetrennt.', 'ok');
}

// ---------------------------------------------------------------------------
// Marker (Punkte für Ebene und Paare)
// ---------------------------------------------------------------------------
const markerCache = new Map();
function markerTextur(text, farbe) {
  const key = text + farbe;
  if (markerCache.has(key)) return markerCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = farbe; g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.fill();
  g.lineWidth = 4; g.strokeStyle = '#000'; g.stroke();
  g.fillStyle = '#000'; g.font = 'bold 30px Segoe UI, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 32, 34);
  const t = new THREE.CanvasTexture(c);
  markerCache.set(key, t);
  return t;
}
function marker(pos, text, farbe) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTextur(text, farbe), depthTest: false, sizeAttenuation: false }));
  s.position.copy(pos);
  s.renderOrder = 10;
  hilfsGruppe.add(s);
}
function markerGroesse() {
  const h = leinwand.clientHeight || 1;
  const skala = 26 / h * 2 * Math.tan(THREE.MathUtils.degToRad(kamera.fov / 2));
  hilfsGruppe.children.forEach((c) => { if (c.isSprite) c.scale.set(skala, skala, 1); });
}

function hilfenZeichnen() {
  hilfsGruppe.children.slice().forEach((c) => {
    hilfsGruppe.remove(c);
    if (c.material) { c.material.dispose(); }
    if (c.geometry) c.geometry.dispose();
  });
  S.ebenePunkte.forEach((p, i) => marker(new THREE.Vector3(...p), String(i + 1), '#e3b341'));
  S.paare.forEach((paar, i) => {
    marker(new THREE.Vector3(...paar.fest), String(i + 1), '#5cbf6a');
    if (paar.bewegt) marker(new THREE.Vector3(...paar.bewegtWelt), String(i + 1), '#e0914f');
  });
  if (S.ebenePunkte.length === 3) ebeneZeichnen();
  paarListeZeichnen();
}

function ebeneZeichnen() {
  const [a, b, c] = S.ebenePunkte.map((p) => new THREE.Vector3(...p));
  const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
  if (S.ebeneUmdrehen) n.negate();
  const versatz = Number(document.querySelector('[data-werkzeug-block=ebene3] [data-p=versatz]').value);
  const k = szenenKugel();
  const mitte = a.clone().add(b).add(c).multiplyScalar(1 / 3).addScaledVector(n, versatz);
  const flaeche = new THREE.Mesh(new THREE.PlaneGeometry(k.radius * 2.4, k.radius * 2.4),
    new THREE.MeshBasicMaterial({ color: 0xe3b341, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  flaeche.position.copy(mitte);
  flaeche.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  hilfsGruppe.add(flaeche);
  const pfeil = new THREE.ArrowHelper(n, mitte, k.radius * 0.4, 0xe0584f, k.radius * 0.08, k.radius * 0.05);
  hilfsGruppe.add(pfeil);
}

function pickModusSetzen(modus) {
  S.pickModus = modus;
  $('#knopfEbenePunkte').classList.toggle('an', modus === 'ebene3');
  $('#knopfPaare').classList.toggle('an', modus === 'paare');
  if (modus) {
    if (S.werkzeug !== 'orbit') werkzeugSetzen('orbit');
    S.pickModus = modus;
    steuerung.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    leinwand.style.cursor = 'copy';
    $('#knopfEbenePunkte').classList.toggle('an', modus === 'ebene3');
    $('#knopfPaare').classList.toggle('an', modus === 'paare');
    pickHinweis();
  } else if (S.werkzeug === 'orbit') {
    steuerung.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    leinwand.style.cursor = 'grab';
  }
}

function pickHinweis() {
  if (S.pickModus === 'ebene3') status(`Schnittebene: Punkt ${S.ebenePunkte.length + 1} von 3 anklicken (rechte Maustaste dreht).`);
  if (S.pickModus === 'paare') {
    const offen = S.paare.length && !S.paare[S.paare.length - 1].bewegt;
    status(offen ? `Paar ${S.paare.length}: dieselbe Stelle auf dem BEWEGTEN Scan anklicken.` : `Paar ${S.paare.length + 1}: Stelle auf dem FESTEN Scan anklicken.`);
  }
}

function pickKlick(x, y) {
  if (S.pickModus === 'ebene3') {
    const p = punktAn(x, y);
    if (!p) { status('Kein Punkt getroffen.'); return; }
    if (S.ebenePunkte.length >= 3) S.ebenePunkte = [];
    S.ebenePunkte.push(p.welt.toArray());
    hilfenZeichnen();
    if (S.ebenePunkte.length === 3) { pickModusSetzen(null); status('Ebene steht. Seite prüfen, dann „Vorschau“.'); } else pickHinweis();
    return;
  }
  if (S.pickModus === 'paare') {
    const fest = Number($('#wahlFest').value), bewegt = Number($('#wahlBewegt').value);
    const offen = S.paare.length && !S.paare[S.paare.length - 1].bewegt;
    const p = punktAn(x, y, offen ? bewegt : fest);
    if (!p) { status(`Kein Punkt auf dem ${offen ? 'bewegten' : 'festen'} Scan getroffen.`); return; }
    if (offen) {
      const paar = S.paare[S.paare.length - 1];
      paar.bewegt = p.lokal.toArray();   // Datei-Koordinaten des bewegten Scans
      paar.bewegtWelt = p.welt.toArray();
    } else {
      S.paare.push({ fest: p.lokal.toArray(), bewegt: null });
    }
    hilfenZeichnen();
    pickHinweis();
  }
}

function paarListeZeichnen() {
  const ol = $('#paarListe');
  ol.innerHTML = '';
  S.paare.forEach((p, i) => {
    const li = document.createElement('li');
    const rest = S.paarRest && S.paarRest[i] !== undefined ? ` · Rest ${S.paarRest[i].toFixed(2)} mm` : '';
    li.textContent = p.bewegt ? `Paar vollständig${rest}` : 'wartet auf Punkt im bewegten Scan';
    if (!p.bewegt) li.className = 'offen';
    ol.appendChild(li);
  });
}

// ---------------------------------------------------------------------------
// Bereinigen
// ---------------------------------------------------------------------------
const versuche = {};

function blockParameter(block) {
  const werkzeug = block.dataset.werkzeugBlock;
  const d = { werkzeug, ids: zielIds() };
  block.querySelectorAll('[data-p]').forEach((el) => {
    d[el.dataset.p] = el.type === 'checkbox' ? el.checked : Number(el.value);
  });
  if (werkzeug === 'tisch') d.versuch = versuche.tisch || 0;
  if (werkzeug === 'ebene3') {
    if (S.ebenePunkte.length !== 3) throw new Error('Erst 3 Punkte für die Ebene setzen.');
    d.punkte = S.ebenePunkte;
    d.umdrehen = S.ebeneUmdrehen;
  }
  if (!d.ids.length) throw new Error('Kein Scan gewählt.');
  return d;
}

async function bereinigenVorschau(block) {
  const d = blockParameter(block);
  const j = await api('bereinigen/vorschau', d, 'Vorschau…');
  for (const e of S.scans.values()) e.vor.fill(0);
  for (const [id, text] of Object.entries(j.masken)) {
    const e = S.scans.get(Number(id));
    if (e) e.vor.set(b64.maske(text, e.n));
  }
  S.vorschau = d;
  $$('section.laeuft').forEach((s) => s.classList.remove('laeuft'));
  block.classList.add('laeuft');
  alleMarkierungen();
  for (const x of Object.values(j.extra || {})) if (x.warnung) meldung(x.warnung, 'fehler');
  if (!j.anzahl) status('Vorschau: nichts zu entfernen.');
}

async function bereinigenAnwenden(block) {
  const d = blockParameter(block);
  const j = await api('bereinigen/anwenden', d, 'Entferne…');
  versuche.tisch = 0;
  bereinigenZuruecksetzen();
  meldung(`${j.geloescht.toLocaleString('de-DE')} Punkte entfernt.`, 'ok');
}

function bereinigenZuruecksetzen() {
  S.vorschau = null;
  for (const e of S.scans.values()) e.vor.fill(0);
  $$('section.laeuft').forEach((s) => s.classList.remove('laeuft'));
  alleMarkierungen();
  status('Vorschau zurückgesetzt.');
}

$$('[data-werkzeug-block]').forEach((block) => {
  const q = (s) => block.querySelector(s);
  q('[data-vorschau]').addEventListener('click', () => sicher(() => bereinigenVorschau(block)));
  q('[data-anwenden]').addEventListener('click', () => sicher(() => bereinigenAnwenden(block)));
  q('[data-zuruecksetzen]').addEventListener('click', () => { versuche.tisch = 0; bereinigenZuruecksetzen(); });
  const naechste = q('[data-naechste]');
  if (naechste) naechste.addEventListener('click', () => { versuche.tisch = (versuche.tisch || 0) + 1; sicher(() => bereinigenVorschau(block)); });
  block.querySelectorAll('input[type=range]').forEach((r) => r.addEventListener('input', () => {
    r.nextElementSibling.textContent = r.value;
    if (block.dataset.werkzeugBlock === 'ebene3') hilfenZeichnen();
  }));
});

async function punktabstandMessen() {
  if (!S.aktiv) throw new Error('Kein Scan aktiv.');
  const j = await api('info/punktabstand', { id: S.aktiv }, 'Messe…');
  const a = j.abstand;
  S.scans.get(S.aktiv).abstand = a;
  eigenschaftenZeichnen();
  $('#abstandInfo').textContent = `≈ ${a.toFixed(3)} mm – Werte angepasst`;
  const setze = (sel, wert) => { const el = document.querySelector(sel); if (el) el.value = +wert.toPrecision(2); };
  setze('[data-werkzeug-block=tisch] [data-p=toleranz]', Math.max(a * 3, 0.1));
  setze('[data-werkzeug-block=inseln] [data-p=abstand]', a * 4);
  setze('[data-werkzeug-block=radius] [data-p=radius]', a * 4);
  setze('#duennVoxel', a * 2);
  setze('#normRadius', a * 6);
  setze('#verbundenAbstand', a * 4);
  return a;
}

// ---------------------------------------------------------------------------
// Ausrichten
// ---------------------------------------------------------------------------
function regParameter() {
  const fest = Number($('#wahlFest').value), bewegt = Number($('#wahlBewegt').value);
  if (!fest || !bewegt) throw new Error('Es braucht mindestens 2 Scans.');
  if (fest === bewegt) throw new Error('Fester und bewegter Scan sind derselbe.');
  return { fest, bewegt, voxel: Number($('#regVoxel').value), fang: Number($('#regFang').value) };
}

function matrixSetzen(e, T) {
  if (T) e.obj.matrix.set(...T.flat()); else e.obj.matrix.identity();
  e.obj.matrixWorldNeedsUpdate = true;
}

function regVorschauSetzen(matrizen, ergebnisHtml, guete) {
  regZuruecksetzen(false);
  S.regMatrizen = matrizen;
  for (const [id, T] of Object.entries(matrizen)) {
    const e = S.scans.get(Number(id));
    if (e) matrixSetzen(e, T);
  }
  const el = $('#regErgebnis');
  el.hidden = false;
  el.className = 'ergebnis ' + (guete || '');
  el.innerHTML = ergebnisHtml;
  hilfenZeichnen();
}

function regZuruecksetzen(meldungZeigen = true) {
  S.regMatrizen = null;
  for (const e of S.scans.values()) matrixSetzen(e, null);
  $('#regErgebnis').hidden = true;
  if (S.abweichung) { S.abweichung = null; alleFarbenSetzen(); }
  if (meldungZeigen) status('Ausrichtung zurückgesetzt.');
}

function guete(ueberlappung, rmse) {
  const abstand = S.letzterAbstand || Number($('#regVoxel').value) / 10;
  if (ueberlappung >= 30 && rmse <= abstand * 3) return 'gut';
  if (ueberlappung >= 15) return 'maessig';
  return 'schlecht';
}

function ergebnisText(j, titel) {
  const g = guete(j.ueberlappung, j.rmse);
  const hinweis = { gut: 'passt gut', maessig: 'prüfen – evtl. Punktpaare oder anderen Fangabstand versuchen', schlecht: 'wahrscheinlich falsch – mehr Überlappung oder Punktpaare nötig' }[g];
  return [`<b>${titel}</b><br>Überlappung ${j.ueberlappung.toFixed(1)} % · Restfehler (RMSE) ${j.rmse.toFixed(3)} mm<br><small>${hinweis}</small>`, g];
}

async function regAuto() {
  const p = regParameter();
  const j = await api('ausrichten/auto', p, 'Richte automatisch aus…');
  const [html, g] = ergebnisText(j, 'Automatisch ausgerichtet');
  regVorschauSetzen({ [p.bewegt]: j.matrix }, html + `<br><small>Grobschritt: Überlappung ${j.grob.ueberlappung.toFixed(0)} % · ${j.dauer} s</small>`, g);
}

async function regIcp() {
  const p = regParameter();
  const start = S.regMatrizen && S.regMatrizen[p.bewegt] ? S.regMatrizen[p.bewegt] : null;
  const j = await api('ausrichten/icp', { ...p, voxel: p.voxel / 3, start, methode: $('#icpMethode').value, iterationen: Number($('#icpIter').value) }, 'Feinregistrierung…');
  const [html, g] = ergebnisText(j, 'Feinregistrierung');
  regVorschauSetzen({ [p.bewegt]: j.matrix }, html + `<br><small>${j.dauer} s</small>`, g);
}

async function paareRechnen() {
  const p = regParameter();
  const fertig = S.paare.filter((x) => x.bewegt);
  if (fertig.length < 3) throw new Error('Es braucht mindestens 3 vollständige Paare.');
  const j = await api('ausrichten/paare', {
    ...p, voxel: p.voxel / 3, icp: $('#paareIcp').checked,
    punkte_bewegt: fertig.map((x) => x.bewegt), punkte_fest: fertig.map((x) => x.fest),
  }, 'Berechne aus Punktpaaren…');
  const paare = j.paare || j;
  S.paarRest = paare.rest_je_paar;
  let html = `<b>Aus ${fertig.length} Punktpaaren</b><br>Restfehler der Paare ${paare.rmse.toFixed(2)} mm`;
  let g = paare.rmse < 2 ? 'gut' : paare.rmse < 5 ? 'maessig' : 'schlecht';
  if (j.paare) {
    const [h2, g2] = ergebnisText(j, 'danach ICP');
    html += '<br>' + h2;
    g = g2;
  }
  pickModusSetzen(null);
  regVorschauSetzen({ [p.bewegt]: j.matrix }, html, g);
}

async function regGlobal() {
  const ids = sichtbareScans().map((e) => e.id);
  if (ids.length < 2) throw new Error('Es braucht mindestens 2 sichtbare Scans.');
  const j = await api('ausrichten/global', { ids, voxel: Number($('#regVoxel').value) / 3, fang: Number($('#regFang').value) }, 'Richte alle gemeinsam aus…');
  const name = (id) => (S.scans.get(id) ? S.scans.get(id).meta.name : id);
  const zeilen = j.paare.map((p) => `<tr><td>${name(p.von)} → ${name(p.zu)}</td><td>${p.ueberlappung.toFixed(0)} %</td><td>${p.rmse.toFixed(3)} mm</td></tr>`).join('');
  const schlecht = j.paare.some((p) => p.ueberlappung < 15);
  regVorschauSetzen(j.matrizen, `<b>Alle gemeinsam</b> (${j.dauer} s)<table>${zeilen}</table>`, schlecht ? 'maessig' : 'gut');
}

async function regAnwenden() {
  if (!S.regMatrizen) throw new Error('Erst eine Vorschau rechnen.');
  const matrizen = S.regMatrizen;
  S.regMatrizen = null;
  await api('ausrichten/anwenden', { matrizen, text: 'Ausgerichtet' }, 'Wende an…');
  S.paare = []; S.paarRest = null;
  regZuruecksetzen(false);
  hilfenZeichnen();
  meldung('Ausrichtung übernommen.', 'ok');
}

async function abweichungZeigen() {
  const p = regParameter();
  const matrix = S.regMatrizen && S.regMatrizen[p.bewegt] ? S.regMatrizen[p.bewegt] : null;
  const j = await api('ausrichten/abweichung', { ...p, matrix }, 'Berechne Abweichung…');
  S.abweichung = { id: p.bewegt, werte: b64.float32(j.werte), max: Number($('#abwMax').value), median: j.median, p95: j.p95 };
  alleFarbenSetzen();
}

async function werteVorschlagen() {
  const p = regParameter();
  const j = await api('info/punktabstand', { id: p.bewegt }, 'Messe…');
  S.letzterAbstand = j.abstand;
  const e = S.scans.get(p.bewegt);
  const diag = e.geo.boundingBox.getSize(new THREE.Vector3()).length();
  const voxel = Math.max(j.abstand * 4, diag / 50);
  $('#regVoxel').value = +voxel.toPrecision(2);
  $('#regFang').value = +(voxel * 0.7).toPrecision(2);
  $('#vorschlagInfo').textContent = `Punktabstand ≈ ${j.abstand.toFixed(3)} mm`;
}

async function zusammenfuehren() {
  const ids = sichtbareScans().map((e) => e.id);
  if (ids.length < 2) throw new Error('Es braucht mindestens 2 sichtbare Scans.');
  if (S.regMatrizen) throw new Error('Es gibt eine nicht übernommene Ausrichtungs-Vorschau – erst anwenden oder zurücksetzen.');
  const j = await api('zusammenfuehren', { ids, voxel: Number($('#mergeVoxel').value) }, 'Führe zusammen…');
  S.aktiv = j.neu;
  listeZeichnen();
  meldung(`Zusammengeführt: ${j.anzahl.toLocaleString('de-DE')} Punkte.`, 'ok');
}

// ---------------------------------------------------------------------------
// Dateien
// ---------------------------------------------------------------------------
async function dateienImportieren(dateien) {
  for (const datei of dateien) {
    await sicher(async () => {
      await mitSanduhr(`Lade ${datei.name}…`, async () => {
        const projekt = datei.name.toLowerCase().endsWith('.v3dscan');
        const url = projekt ? '/api/projekt/laden' : '/api/import?name=' + encodeURIComponent(datei.name);
        const r = await fetch(url, { method: 'POST', body: datei });
        const j = await r.json();
        if (!r.ok || j.fehler) throw new Error(`${datei.name}: ${j.fehler || r.status}`);
        if (projekt) { for (const e of S.scans.values()) szene.remove(e.obj); S.scans.clear(); }
        await zustandUebernehmen(j);
        if (j.neu) S.aktiv = j.neu;
        listeZeichnen();
        auswahlListenFuellen();
        if (S.scans.size === 1 || projekt) einpassen();
        meldung(`${datei.name} geladen.`, 'ok');
      });
    });
  }
}

function herunterladen(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

$('#dateiWahl').addEventListener('change', (ev) => {
  const d = [...ev.target.files];
  ev.target.value = '';
  dateienImportieren(d);
});
let ablageZaehler = 0;
window.addEventListener('dragenter', (ev) => { ev.preventDefault(); ablageZaehler++; $('#ablage').hidden = false; });
window.addEventListener('dragleave', () => { if (--ablageZaehler <= 0) { ablageZaehler = 0; $('#ablage').hidden = true; } });
window.addEventListener('dragover', (ev) => ev.preventDefault());
window.addEventListener('drop', (ev) => {
  ev.preventDefault();
  ablageZaehler = 0;
  $('#ablage').hidden = true;
  if (ev.dataTransfer.files.length) dateienImportieren([...ev.dataTransfer.files]);
});

// ---------------------------------------------------------------------------
// Aktionen + Tastenkürzel
// ---------------------------------------------------------------------------
const AKTIONEN = {
  neu: { text: 'Neues Projekt', fn: async () => {
    if (S.zustand.scans.length && !confirm('Alle Scans schließen? Nicht gespeicherte Änderungen gehen verloren.')) return;
    const r = await fetch('/api/projekt/neu', { method: 'POST' });
    await zustandUebernehmen(await r.json());
  } },
  importieren: { text: 'Öffnen / Importieren', taste: 'Ctrl+O', fn: () => $('#dateiWahl').click() },
  speichern: { text: 'Projekt speichern', taste: 'Ctrl+S', fn: () => herunterladen('/api/projekt/speichern') },
  exportieren: { text: 'Aktiven Scan exportieren', taste: 'Ctrl+E', fn: () => {
    if (!S.aktiv) throw new Error('Kein Scan aktiv.');
    herunterladen(`/api/export/${S.aktiv}?format=${$('#exportFormat').value}`);
  } },
  rueckgaengig: { text: 'Rückgängig', taste: 'Ctrl+Z', fn: async () => { const j = await api('rueckgaengig', {}, 'Rückgängig…'); if (j.text) status('Rückgängig: ' + j.text); } },
  wiederholen: { text: 'Wiederholen', taste: 'Ctrl+Y', fn: async () => { const j = await api('wiederholen', {}, 'Wiederholen…'); if (j.text) status('Wiederholt: ' + j.text); } },
  orbit: { text: 'Werkzeug: Drehen', taste: 'V', fn: () => werkzeugSetzen('orbit') },
  rechteck: { text: 'Werkzeug: Rechteck', taste: 'M', fn: () => werkzeugSetzen('rechteck') },
  lasso: { text: 'Werkzeug: Lasso', taste: 'L', fn: () => werkzeugSetzen('lasso') },
  polygon: { text: 'Werkzeug: Polygon', taste: 'P', fn: () => werkzeugSetzen('polygon') },
  polygonSchliessen: { text: 'Polygon schließen', taste: 'Enter', fn: () => polygonSchliessen() },
  polygonZurueck: { text: 'Polygon: letzte Ecke zurück', taste: 'Backspace', fn: () => {
    if (zug && zug.art === 'polygon') { zug.punkte.pop(); if (!zug.punkte.length) { zug = null; zeichnung.innerHTML = ''; } else zugZeichnen(); }
  } },
  verbunden: { text: 'Werkzeug: Verbunden', taste: 'B', fn: () => werkzeugSetzen('verbunden') },
  durch: { text: 'Durch das Modell wählen', taste: 'T', fn: () => durchSetzen(!S.durch) },
  alles: { text: 'Alles wählen', taste: 'Ctrl+A', fn: () => auswahlAlle(1) },
  nichts: { text: 'Auswahl aufheben / Abbrechen', taste: 'Escape', fn: () => {
    if (zug) { zug = null; zeichnung.innerHTML = ''; status('Abgebrochen.'); return; }
    if (S.pickModus) { pickModusSetzen(null); status('Punkte setzen beendet.'); return; }
    auswahlAlle(0);
  } },
  invertieren: { text: 'Auswahl umkehren', taste: 'Ctrl+I', fn: auswahlUmkehren },
  loeschen: { text: 'Gewählte Punkte löschen', taste: 'Delete', fn: auswahlLoeschen },
  abtrennen: { text: 'Auswahl abtrennen', taste: 'Ctrl+D', fn: auswahlAbtrennen },
  einpassen: { text: 'Ansicht einpassen', taste: 'F', fn: einpassen },
  blickVorne: { text: 'Blick von vorne', taste: '1', fn: () => blick(achsenRichtung('vorne')) },
  blickOben: { text: 'Blick von oben', taste: '2', fn: () => blick(achsenRichtung('oben')) },
  blickRechts: { text: 'Blick von rechts', taste: '3', fn: () => blick(achsenRichtung('rechts')) },
  blickIso: { text: 'Blick schräg', taste: '4', fn: () => blick(achsenRichtung('iso')) },
  groesser: { text: 'Punkte größer', taste: '+', fn: () => punktGroesseSetzen(S.punktGroesse + 0.5) },
  kleiner: { text: 'Punkte kleiner', taste: '-', fn: () => punktGroesseSetzen(S.punktGroesse - 0.5) },
  punktabstand: { text: 'Punktabstand messen', fn: punktabstandMessen },
  ebenePunkte: { text: 'Schnittebene: 3 Punkte setzen', fn: () => { S.ebenePunkte = []; hilfenZeichnen(); pickModusSetzen(S.pickModus === 'ebene3' ? null : 'ebene3'); } },
  ebeneUmdrehen: { text: 'Schnittebene umdrehen', fn: () => { S.ebeneUmdrehen = !S.ebeneUmdrehen; hilfenZeichnen(); } },
  duennVorschau: { text: 'Ausdünnen Vorschau', fn: async () => {
    const j = await api('ausduennen/vorschau', { ids: zielIds(), voxel: Number($('#duennVoxel').value) }, 'Rechne…');
    $('#duennInfo').textContent = `${j.vorher.toLocaleString('de-DE')} → ${j.nachher.toLocaleString('de-DE')} Punkte (${(100 * j.nachher / Math.max(1, j.vorher)).toFixed(0)} %)`;
  } },
  duennAnwenden: { text: 'Ausdünnen anwenden', fn: async () => {
    const j = await api('ausduennen/anwenden', { ids: zielIds(), voxel: Number($('#duennVoxel').value) }, 'Dünne aus…');
    $('#duennInfo').textContent = `Jetzt ${j.nachher.toLocaleString('de-DE')} Punkte.`;
  } },
  normalen: { text: 'Normalen berechnen', fn: async () => {
    await api('normalen', { ids: zielIds(), radius: Number($('#normRadius').value), ausrichtung: $('#normAusrichtung').value }, 'Berechne Normalen…');
    meldung('Normalen berechnet.', 'ok');
  } },
  vorschlagWerte: { text: 'Ausrichten: Werte vorschlagen', fn: werteVorschlagen },
  regAuto: { text: 'Automatisch ausrichten', fn: regAuto },
  regIcp: { text: 'Feinregistrierung', fn: regIcp },
  regGlobal: { text: 'Alle gemeinsam ausrichten', fn: regGlobal },
  regAnwenden: { text: 'Ausrichtung anwenden', fn: regAnwenden },
  regZurueck: { text: 'Ausrichtung zurücksetzen', fn: () => regZuruecksetzen() },
  paareSetzen: { text: 'Punktpaare setzen', fn: () => pickModusSetzen(S.pickModus === 'paare' ? null : 'paare') },
  paarWeg: { text: 'Letzten Paarpunkt entfernen', fn: () => {
    const l = S.paare[S.paare.length - 1];
    if (!l) return;
    if (l.bewegt) { l.bewegt = null; l.bewegtWelt = null; } else S.paare.pop();
    hilfenZeichnen(); pickHinweis();
  } },
  paareLeeren: { text: 'Alle Paare entfernen', fn: () => { S.paare = []; S.paarRest = null; hilfenZeichnen(); pickHinweis(); } },
  paareRechnen: { text: 'Aus Punktpaaren berechnen', fn: paareRechnen },
  abweichung: { text: 'Abweichungskarte', fn: abweichungZeigen },
  abweichungAus: { text: 'Abweichungskarte aus', fn: () => { S.abweichung = null; alleFarbenSetzen(); } },
  zusammenfuehren: { text: 'Zusammenführen', fn: zusammenfuehren },
  tasten: { text: 'Tastenkürzel', fn: tastenDialog },
  tastenZu: { text: '', fn: () => $('#tastenDialog').close() },
  tastenStandard: { text: '', fn: () => { localStorage.removeItem('v3dscan.tasten'); tastenLaden(); tastenTabelle(); } },
};

let tasten = {};
function tastenLaden() {
  tasten = {};
  let eigene = {};
  try { eigene = JSON.parse(localStorage.getItem('v3dscan.tasten') || '{}'); } catch { eigene = {}; }
  for (const [id, a] of Object.entries(AKTIONEN)) {
    const t = id in eigene ? eigene[id] : a.taste;
    if (t) tasten[t] = id;
  }
}
function tasteVon(ev) {
  let k = ev.key;
  if (k === ' ') k = 'Space';
  if (k.length === 1) k = k.toUpperCase();
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return null;
  return (ev.ctrlKey || ev.metaKey ? 'Ctrl+' : '') + (ev.altKey ? 'Alt+' : '') + (ev.shiftKey && k.length > 1 ? 'Shift+' : '') + k;
}
function aktionAusfuehren(id) {
  const a = AKTIONEN[id];
  if (!a || S.beschaeftigt) return;
  sicher(() => a.fn());
}

let tasteWartet = null;
window.addEventListener('keydown', (ev) => {
  if (tasteWartet) {
    ev.preventDefault();
    const t = tasteVon(ev);
    if (!t) return;
    if (t !== 'Escape') {
      const eigene = JSON.parse(localStorage.getItem('v3dscan.tasten') || '{}');
      for (const [id, taste] of Object.entries({ ...Object.fromEntries(Object.entries(AKTIONEN).map(([i, a]) => [i, a.taste])), ...eigene })) {
        if (taste === t && id !== tasteWartet) eigene[id] = '';
      }
      eigene[tasteWartet] = t;
      localStorage.setItem('v3dscan.tasten', JSON.stringify(eigene));
      tastenLaden();
    }
    tasteWartet = null;
    tastenTabelle();
    return;
  }
  if (ev.target.matches('input[type=number], input[type=text], select') && ev.key !== 'Escape') return;
  const t = tasteVon(ev);
  if (t && tasten[t]) {
    ev.preventDefault();
    aktionAusfuehren(tasten[t]);
  }
});

function tastenTabelle() {
  const tab = $('#tastenTabelle');
  const umgekehrt = Object.fromEntries(Object.entries(tasten).map(([t, id]) => [id, t]));
  tab.innerHTML = '';
  for (const [id, a] of Object.entries(AKTIONEN)) {
    if (!a.text) continue;
    const tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td></td>';
    tr.children[0].textContent = a.text;
    const b = document.createElement('button');
    b.textContent = tasteWartet === id ? 'Taste drücken…' : (umgekehrt[id] || '—');
    if (tasteWartet === id) b.className = 'wartet';
    b.addEventListener('click', () => { tasteWartet = id; tastenTabelle(); });
    tr.children[1].appendChild(b);
    tab.appendChild(tr);
  }
}
function tastenDialog() { tastenTabelle(); $('#tastenDialog').showModal(); }

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-aktion]');
  if (el) { ev.preventDefault(); aktionAusfuehren(el.dataset.aktion); return; }
  const w = ev.target.closest('[data-werkzeug]');
  if (w && w.tagName === 'BUTTON') werkzeugSetzen(w.dataset.werkzeug);
});

// Reiter
$$('#reiter button').forEach((b) => b.addEventListener('click', () => {
  $$('#reiter button').forEach((x) => x.classList.toggle('an', x === b));
  $$('.seite').forEach((s) => s.classList.toggle('an', s.id === 's-' + b.dataset.reiter));
}));

// Ansicht-Einstellungen
function punktGroesseSetzen(v) {
  S.punktGroesse = Math.min(10, Math.max(1, v));
  $('#punktGroesse').value = S.punktGroesse;
  $('#punktGroesse').nextElementSibling.textContent = S.punktGroesse;
  einstellungenMerken();
}
$('#punktGroesse').addEventListener('input', (ev) => punktGroesseSetzen(Number(ev.target.value)));
$('#farbModus').addEventListener('change', (ev) => { S.farbModus = ev.target.value; alleFarbenSetzen(); einstellungenMerken(); });
$('#schattierung').addEventListener('change', (ev) => { S.schattierung = ev.target.checked; alleFarbenSetzen(); einstellungenMerken(); });
$('#obenAchse').addEventListener('change', (ev) => { S.oben = ev.target.value; blick(achsenRichtung('iso')); alleFarbenSetzen(); einstellungenMerken(); });
$('#durchWahl').addEventListener('change', (ev) => durchSetzen(ev.target.checked));
$('#wahlBewegt').addEventListener('change', () => { S.paare = []; S.paarRest = null; hilfenZeichnen(); regZuruecksetzen(false); });
$('#wahlFest').addEventListener('change', () => {
  S.paare = []; S.paarRest = null; hilfenZeichnen(); regZuruecksetzen(false);
  sicher(() => api('scan/setzen', { id: Number($('#wahlFest').value), fest: true }));
});

function einstellungenMerken() {
  localStorage.setItem('v3dscan.ansicht', JSON.stringify({ punktGroesse: S.punktGroesse, farbModus: S.farbModus, schattierung: S.schattierung, oben: S.oben }));
}
function einstellungenLaden() {
  try {
    const a = JSON.parse(localStorage.getItem('v3dscan.ansicht') || '{}');
    Object.assign(S, a);
  } catch { /* egal */ }
  $('#punktGroesse').value = S.punktGroesse;
  $('#punktGroesse').nextElementSibling.textContent = S.punktGroesse;
  $('#farbModus').value = S.farbModus;
  $('#schattierung').checked = S.schattierung;
  $('#obenAchse').value = S.oben;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function start() {
  einstellungenLaden();
  tastenLaden();
  werkzeugSetzen('orbit');
  groesseAnpassen();
  zeichnen();
  const r = await fetch('/api/zustand');
  const z = await r.json();
  $('#fassung').textContent = 'V3D Scan ' + z.fassung;
  $('#exportFormat').innerHTML = z.formate.map((f) => `<option value="${f}">${f.toUpperCase()}</option>`).join('');
  await zustandUebernehmen(z);
  if (z.scans.length) blick(achsenRichtung('iso'));
  else gitterSetzen(new THREE.Sphere(new THREE.Vector3(), 100));
  setInterval(() => fetch('/api/puls').catch(() => status('Verbindung zum Dienst verloren – Programm neu starten.')), 10000);
  fetch('/api/puls');
  steuerung.addEventListener('change', kameraGrenzen);
  window.v3dscan = { S, api, einpassen, werkzeugSetzen, punktAn, auswahlAnwenden, kamera, steuerung, renderer };
}
start().catch((e) => meldung('Start fehlgeschlagen: ' + e.message, 'fehler'));
