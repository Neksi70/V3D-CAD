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
  netzAnsicht: 'flaeche',
  vorschau: null,          // {art:'bereinigen', werkzeug, parameter}
  ebenePunkte: [],         // Schnittebene: bis zu 3 Weltpunkte
  ebeneUmdrehen: false,
  pickModus: null,         // 'ebene3' | 'paare' | null
  paare: [],               // [{fest:[x,y,z], bewegt:[x,y,z]|null}]
  regMatrizen: null,       // {id: 4x4} Vorschau-Ausrichtung
  koord: { primaer: null, sekundaer: null, ursprung: null },
  koordPick: null,         // {slot, art, anzahl, punkte:[]}
  erkennung: null,         // {id, rev, elemente, labels:Int16Array, zusammenfassung}
  formAktiv: null,         // gewähltes Element
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
    if (text) konsole(`${text.replace(/…$/, '')} – fertig`);
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
  konsole(text, art);
}

function status(text) { $('#statusText').textContent = text; }

// Konsole unten: Protokoll aller Meldungen und Ergebnisse mit Zeitstempel
function konsole(text, art = '') {
  const box = $('#konsoleText');
  const z = document.createElement('div');
  if (art) z.className = art;
  const t = new Date();
  z.textContent = `[${t.toLocaleTimeString('de-DE')}] ${text}`;
  box.appendChild(z);
  while (box.childElementCount > 300) box.firstElementChild.remove();
  box.scrollTop = box.scrollHeight;
}

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
const renderer = new THREE.WebGLRenderer({ canvas: leinwand, antialias: true, alpha: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(window.devicePixelRatio);
// Hintergrund (heller Verlauf) kommt aus CSS hinter der Leinwand
renderer.setClearColor(0x000000, 0);
const szene = new THREE.Scene();
const kamera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
kamera.position.set(0, 150, 400);
const steuerung = new OrbitControls(kamera, leinwand);
steuerung.enableDamping = false;
steuerung.zoomToCursor = true;
const hilfsGruppe = new THREE.Group();
szene.add(hilfsGruppe);
// Licht nur für Körper (Scans haben eigene Shader ohne Licht)
szene.add(new THREE.HemisphereLight(0xffffff, 0x8a9099, 1.6));
const kameraLicht = new THREE.DirectionalLight(0xffffff, 1.4);
kamera.add(kameraLicht);
kameraLicht.position.set(0.4, 0.8, 1);
szene.add(kamera);
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
    else if (mark > 0.5) c = mix(c, vec3(0.05, 0.78, 0.84), 0.85);
    vFarbe = c;
  }`;
const PUNKT_FS = `
  varying vec3 vFarbe;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    if (dot(p, p) > 1.0) discard;
    gl_FragColor = vec4(vFarbe, 1.0);
  }`;
const NETZ_VS = `
  attribute vec3 farbe;
  attribute float mark;
  attribute vec3 normale;
  varying vec3 vFarbe;
  varying vec3 vNormale;
  varying vec3 vSicht;
  varying float vMark;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vFarbe = farbe;
    vNormale = normalMatrix * normale;
    vSicht = -mv.xyz;
    vMark = mark;
  }`;
const NETZ_FS = `
  varying vec3 vFarbe;
  varying vec3 vNormale;
  varying vec3 vSicht;
  varying float vMark;
  void main() {
    vec3 n = normalize(vNormale);
    vec3 v = normalize(vSicht);
    // Rueckseiten dunkler-blaeulich: zeigt verdrehte Normalen und Loecher
    float vorne = gl_FrontFacing ? 1.0 : 0.0;
    float l = abs(dot(n, v));
    vec3 c = vFarbe * (0.28 + 0.78 * l);
    vec3 h = normalize(v + vec3(0.3, 0.5, 0.2));
    c += vec3(0.12) * pow(max(dot(n * (vorne * 2.0 - 1.0), h), 0.0), 24.0);
    if (vorne < 0.5) c = mix(c, vec3(0.25, 0.3, 0.55), 0.6);
    if (vMark > 1.5) c = vec3(1.0, 0.18, 0.12);
    else if (vMark > 0.5) c = mix(c, vec3(0.05, 0.78, 0.84), 0.85);
    gl_FragColor = vec4(c, 1.0);
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
const TIEFE_NETZ_FS = `
  varying float vTiefe;
  void main() {
    vec4 e = fract(vec4(1.0, 255.0, 65025.0, 16581375.0) * vTiefe);
    e -= e.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
    gl_FragColor = e;
  }`;
const tiefeNetzMaterial = new THREE.ShaderMaterial({
  vertexShader: TIEFE_VS, fragmentShader: TIEFE_NETZ_FS, side: THREE.DoubleSide,
  uniforms: { groesse: { value: 1 }, nah: { value: 0.1 }, fern: { value: 1000 } },
});
const tiefeMaterial = new THREE.ShaderMaterial({
  vertexShader: TIEFE_VS, fragmentShader: TIEFE_FS,
  uniforms: { groesse: { value: 2 }, nah: { value: 0.1 }, fern: { value: 1000 } },
});

function groesseUniform() { return S.punktGroesse * renderer.getPixelRatio(); }

// ---------------------------------------------------------------------------
// Scans
// ---------------------------------------------------------------------------
function datenLesen(puffer) {
  const kopf = new Uint32Array(puffer, 0, 2);
  const n = kopf[0], flags = kopf[1];
  let o = 8;
  const xyz = new Float32Array(puffer, o, n * 3); o += n * 12;
  let rgb = null, nrm = null, tri = null;
  if (flags & 1) { rgb = new Uint8Array(puffer, o, n * 3); o += Math.ceil(n * 3 / 4) * 4; }
  if (flags & 2) { nrm = new Float32Array(puffer, o, n * 3); o += n * 12; }
  if (flags & 4) { const m = new Uint32Array(puffer, o, 1)[0]; o += 4; tri = new Uint32Array(puffer, o, m * 3); }
  return { n, xyz, rgb, nrm, tri };
}

function objektBauen(d, farbeHex) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(d.xyz, 3));
  const farbe = new Uint8Array(d.n * 3);
  geo.setAttribute('farbe', new THREE.BufferAttribute(farbe, 3, true));
  const mark = new Uint8Array(d.n);
  geo.setAttribute('mark', new THREE.BufferAttribute(mark, 1));
  // Ohne Normalen liest der Shader das Attribut nicht (hatNormalen=0), WebGL
  // verlangt aber trotzdem eines in voller Länge.
  geo.setAttribute('normale', new THREE.BufferAttribute(d.nrm || new Float32Array(d.n * 3), 3));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  let obj;
  if (d.tri && S.netzAnsicht !== 'punkte') {
    geo.setIndex(new THREE.BufferAttribute(d.tri, 1));
    const mat = new THREE.ShaderMaterial({ vertexShader: NETZ_VS, fragmentShader: NETZ_FS, side: THREE.DoubleSide,
      wireframe: S.netzAnsicht === 'draht', uniforms: {} });
    obj = new THREE.Mesh(geo, mat);
    obj.userData.tiefe = tiefeNetzMaterial;
  } else {
    const mat = new THREE.ShaderMaterial({
      vertexShader: PUNKT_VS, fragmentShader: PUNKT_FS,
      uniforms: { groesse: { value: groesseUniform() }, hatNormalen: { value: d.nrm ? 1 : 0 }, schatten: { value: S.schattierung ? 1 : 0 } },
    });
    obj = new THREE.Points(geo, mat);
    obj.userData.tiefe = tiefeMaterial;
  }
  obj.matrixAutoUpdate = false;
  return { obj, geo, farbe, mark };
}

async function scanLaden(meta) {
  const r = await fetch('/api/punkte/' + meta.id);
  if (!r.ok) throw new Error('Punkte von Scan ' + meta.id + ' nicht ladbar');
  const d = datenLesen(await r.arrayBuffer());
  let e = S.scans.get(meta.id);
  if (e) objektWeg(e);
  const { obj, geo, farbe, mark } = objektBauen(d, meta.farbe);
  obj.userData.scanId = meta.id;
  szene.add(obj);
  e = { id: meta.id, meta, n: d.n, xyz: d.xyz, rgb: d.rgb, nrm: d.nrm, tri: d.tri, geo, obj, farbe, mark,
        sel: new Uint8Array(d.n), vor: new Uint8Array(d.n), rev: meta.rev };
  S.scans.set(meta.id, e);
  return e;
}

function objektWeg(e) {
  szene.remove(e.obj); e.geo.dispose(); e.obj.material.dispose();
  if (e.vorschau) { szene.remove(e.vorschau.obj); e.vorschau.geo.dispose(); e.vorschau.obj.material.dispose(); e.vorschau = null; }
}

// Netz-Vorschau: Ergebnis vom Dienst anzeigen, Original ausblenden.
async function netzVorschauZeigen(id) {
  const e = S.scans.get(id);
  const r = await fetch('/api/vorschau/' + id);
  if (!r.ok) throw new Error('Vorschau nicht abrufbar');
  const d = datenLesen(await r.arrayBuffer());
  netzVorschauWeg(id);
  const v = objektBauen(d, e.meta.farbe);
  const eigen = hexZuRgb(e.meta.farbe);
  if (d.rgb && S.farbModus === 'rgb') v.farbe.set(d.rgb);
  else for (let i = 0; i < d.n; i++) { v.farbe[i * 3] = eigen[0] * 0.8 + 50; v.farbe[i * 3 + 1] = eigen[1] * 0.8 + 50; v.farbe[i * 3 + 2] = eigen[2] * 0.8 + 50; }
  szene.add(v.obj);
  e.vorschau = v;
  e.obj.visible = false;
}

function netzVorschauWeg(id) {
  const e = S.scans.get(id);
  if (!e || !e.vorschau) return;
  szene.remove(e.vorschau.obj); e.vorschau.geo.dispose(); e.vorschau.obj.material.dispose();
  e.vorschau = null;
  e.obj.visible = e.meta.sichtbar;
}

async function zustandUebernehmen(z) {
  const erstesMal = S.scans.size === 0;
  S.zustand = z;
  const ids = new Set(z.scans.map((s) => s.id));
  for (const [id, e] of S.scans) {
    if (!ids.has(id)) {
      objektWeg(e);
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
    const eintrag = S.scans.get(meta.id);
    eintrag.obj.visible = meta.sichtbar && !eintrag.vorschau;
    if (eintrag.vorschau) eintrag.vorschau.obj.visible = meta.sichtbar;
    if (S.loecher && S.loecher.id === meta.id && S.loecher.rev !== meta.rev) S.loecher = null;
    if (S.erkennung && S.erkennung.id === meta.id && S.erkennung.rev !== meta.rev) { S.erkennung = null; formListeZeichnen(); }
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
  await koerperUebernehmen(z.koerper || []);
  await skizzenUebernehmen(z.skizzen || []);
  referenzenUebernehmen(z.referenzen || []);
  elementEigenschaften();
  if (erstesMal && z.scans.length) einpassen();
  hilfenZeichnen();
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
      <span class="zahl">${meta.dreiecke ? `Netz · ${meta.dreiecke.toLocaleString('de-DE')} Dreiecke` : `${meta.anzahl.toLocaleString('de-DE')} Punkte`}${meta.hat_farbe ? ' · Farbe' : ''}${!meta.dreiecke && meta.hat_normalen ? ' · Normalen' : ''}</span>`;
    el.querySelector('.name').textContent = meta.name;
    el.addEventListener('click', () => {
      S.aktiv = meta.id; listeZeichnen(); auswahlListenFuellen();
      sicher(() => formenLaden(meta.id));
    });
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

function exportFormateSetzen() {
  const e = S.scans.get(S.aktiv);
  const liste = e && e.tri ? S.formateNetz : S.formate;
  if (!liste) return;
  const el = $('#exportFormat');
  const schluessel = liste.join();
  if (el.dataset.liste === schluessel) return;
  el.dataset.liste = schluessel;
  el.innerHTML = liste.map((f) => `<option value="${f}">${f.toUpperCase()}</option>`).join('');
}

function eigenschaftenZeichnen() {
  const e = S.scans.get(S.aktiv);
  exportFormateSetzen();
  $('#netzHinweis').textContent = !e ? 'Kein Scan aktiv.' : e.tri ? `Aktiv: ${e.meta.name} (Netz)` : `Aktiv: ${e.meta.name} – Punktwolke: erst „Netz aus Punktwolke“.`;
  // Analyse und Lochliste gehören zu genau einem Scan-Stand
  const analyseTab = $('#analyseTabelle');
  if (analyseTab.dataset.fuer && analyseTab.dataset.fuer !== `${S.aktiv}:${e ? e.meta.rev : ''}`) {
    analyseTab.innerHTML = '';
    analyseTab.dataset.fuer = '';
    $('#lochListe').innerHTML = '';
  }
  $('#eigenschaften').hidden = !e;
  elementEigenschaften();
  if (!e) return;
  const bb = e.geo.boundingBox, groesse = bb.getSize(new THREE.Vector3()), mitte = bb.getCenter(new THREE.Vector3());
  const f = (v) => v.toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const zeilen = [
    ['Name', e.meta.name],
    ['Art', e.tri ? 'Dreiecksnetz' : 'Punktwolke'],
    [e.tri ? 'Eckpunkte / Dreiecke' : 'Punkte', e.tri ? `${e.n.toLocaleString('de-DE')} / ${(e.tri.length / 3).toLocaleString('de-DE')}` : e.n.toLocaleString('de-DE')],
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

function sichtbareScans() { return [...S.scans.values()].filter((e) => e.meta.sichtbar); }

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
  if (abw && abw.koerper) {
    // Scan <-> Koerper: mit Vorzeichen, Turbo-Mitte = 0, Toleranzband gruen
    const grau = 150;
    for (let i = 0; i < n; i++) {
      const w = abw.werte[i], a = Math.abs(w);
      if (abw.aus > 0 && a > abw.aus) { f[i * 3] = f[i * 3 + 1] = f[i * 3 + 2] = grau; }
      else if (a <= abw.tol) { f[i * 3] = 46; f[i * 3 + 1] = 190; f[i * 3 + 2] = 90; }
      else farbskala(0.5 + 0.5 * w / abw.max, f, i * 3);
    }
  } else if (abw) {
    const grau = 110;
    for (let i = 0; i < n; i++) {
      const w = abw.werte[i];
      if (w > abw.max * 1.5) { f[i * 3] = f[i * 3 + 1] = f[i * 3 + 2] = grau; } else farbskala(w / abw.max, f, i * 3);
    }
  } else if (S.farbModus === 'segmente') {
    const erk = S.erkennung && S.erkennung.id === e.id && S.erkennung.rev === e.meta.rev ? S.erkennung : null;
    if (!erk) {
      for (let i = 0; i < n * 3; i++) f[i] = 95;
    } else {
      const tabelle = new Map(erk.elemente.map((el) => [el.id, formFarbe(el)]));
      for (let i = 0; i < n; i++) {
        const l = erk.labels[i];
        const c = l >= 0 ? (tabelle.get(l) || [90, 90, 90]) : l === -1 ? [70, 72, 78] : [205, 150, 175];
        f[i * 3] = c[0]; f[i * 3 + 1] = c[1]; f[i * 3 + 2] = c[2];
      }
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
  if (e.obj.material.uniforms.schatten) e.obj.material.uniforms.schatten.value = S.schattierung && S.farbModus !== 'normalen' ? 1 : 0;
}

function legendeZeichnen() {
  const el = $('#legende');
  if (!S.abweichung) { el.hidden = true; return; }
  const stops = TURBO.map((c, i) => `rgb(${c}) ${(i / (TURBO.length - 1) * 100).toFixed(0)}%`).join(',');
  const a = S.abweichung;
  el.hidden = false;
  if (a.koerper) {
    const k = a.kennwerte, z = (x) => (x > 0 ? '+' : '') + x.toFixed(3);
    el.innerHTML = `<div>Abweichung Scan ↔ Körper</div>
    <div class="balken" style="background:linear-gradient(90deg,${stops})"></div>
    <div class="skala"><span>−${a.max.toFixed(2)}</span><span>0</span><span>+${a.max.toFixed(2)} mm</span></div>
    <div>${k.anzahl ? `Mittel ${z(k.mittel)} · σ ${k.std.toFixed(3)} · ${k.in_toleranz.toFixed(1)} % in ±${a.tol}` : 'keine Punkte am Körper'}<br>
    <small>grün = ±${a.tol} mm · rot = mehr Material · grau = weiter als ${a.aus} mm</small></div>`;
    return;
  }
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
  if (S.koerper) for (const k of S.koerper.values()) if (k.meta.sichtbar) box.union(k.flaeche.geometry.boundingBox);
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
  gitter = new THREE.GridHelper(groesse, 20, 0x8f97a1, 0xb4bac2);
  gitter.material.transparent = true;
  gitter.material.opacity = 0.6;
  if (S.oben === 'z') gitter.rotation.x = Math.PI / 2;
  const unten = new THREE.Box3();
  for (const e of sichtbareScans()) unten.union(e.geo.boundingBox);
  const o = obenVektor();
  if (!unten.isEmpty()) gitter.position.copy(k.center).sub(o.clone().multiplyScalar(k.center.dot(o) - unten.min.dot(o)));
  szene.add(gitter);
  if (!S.weltAchsen) { S.weltAchsen = new THREE.AxesHelper(1); S.weltAchsen.renderOrder = 4; szene.add(S.weltAchsen); }
  S.weltAchsen.scale.setScalar(Math.max(k.radius * 0.3, 1));
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
  for (const e of S.scans.values()) if (e.obj.material.uniforms.groesse) e.obj.material.uniforms.groesse.value = g;
  markerGroesse();
  renderer.render(szene, kamera);
  achsenZeichnen();
  massstabZeichnen();
}

let massstabAlt = '';
function massstabZeichnen() {
  const h = leinwand.clientHeight || 1;
  const dist = kamera.position.distanceTo(steuerung.target);
  const mmProPx = 2 * dist * Math.tan(THREE.MathUtils.degToRad(kamera.fov / 2)) / h;
  const roh = mmProPx * 70;
  const stufe = Math.pow(10, Math.floor(Math.log10(roh)));
  const wert = [1, 2, 5, 10].map((f) => f * stufe).find((v) => v >= roh * 0.6) || stufe * 10;
  const px = wert / mmProPx;
  const text = `${wert.toLocaleString('de-DE')} mm|${px.toFixed(0)}`;
  if (text === massstabAlt) return;
  massstabAlt = text;
  $('#massstab .balken').style.width = px.toFixed(0) + 'px';
  $('#massstab span').textContent = wert.toLocaleString('de-DE') + ' mm';
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
  tiefeNetzMaterial.uniforms.nah.value = kamera.near;
  tiefeNetzMaterial.uniforms.fern.value = kamera.far;
  const altHilfe = hilfsGruppe.visible, altGitter = gitter ? gitter.visible : false, altKoerper = koerperGruppe.visible;
  hilfsGruppe.visible = false; if (gitter) gitter.visible = false; koerperGruppe.visible = false;
  if (S.weltAchsen) S.weltAchsen.visible = false;
  const getauscht = [];
  for (const e of S.scans.values()) { getauscht.push([e.obj, e.obj.material]); e.obj.material = e.obj.userData.tiefe; }
  const altFarbe = renderer.getClearColor(new THREE.Color()), altAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0xffffff, 1);
  renderer.setRenderTarget(ziel);
  renderer.clear();
  renderer.render(szene, kamera);
  const pixel = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(ziel, 0, 0, w, h, pixel);
  renderer.setRenderTarget(null);
  renderer.setClearColor(altFarbe, altAlpha);
  for (const [o, m] of getauscht) o.material = m;
  hilfsGruppe.visible = altHilfe; if (gitter) gitter.visible = altGitter; koerperGruppe.visible = altKoerper;
  if (S.weltAchsen) S.weltAchsen.visible = true;
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

// Klick (ohne Ziehen) im Drehen-Werkzeug wählt den Bereich unter der Maus
let klickStart = null;
leinwand.addEventListener('pointerdown', (ev) => { klickStart = ev.button === 0 ? lokalePos(ev) : null; });
leinwand.addEventListener('pointerup', (ev) => {
  if (!klickStart || S.werkzeug !== 'orbit' || S.pickModus || S.beschaeftigt) return;
  const [x, y] = lokalePos(ev);
  if (Math.hypot(x - klickStart[0], y - klickStart[1]) > 4) return;
  klickStart = null;
  if (WF.haupt && WF.haupt.id === 'w-kanten') { kanteKlick(x, y); return; }
  if (WF.haupt && WF.haupt.id === 'w-schale') { flaecheKlick(x, y); return; }
  if (WF.haupt && WF.haupt.id === 'w-messen') { messKlick(x, y); return; }
  if (WF.haupt && WF.haupt.id === 'w-abwickeln') { awKlick(x, y); return; }
  const erk = S.erkennung;
  if (!erk) return;
  const p = punktAn(x, y, erk.id);
  if (!p) return;
  const l = erk.labels[p.index];
  const el = l >= 0 ? erk.elemente.find((q) => q.id === l) : null;
  if (el) formWaehlen(el, false);
  else status('Kein Bereich an dieser Stelle (Freiform/ungeordnet).');
});

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
  const farbe = zug.weg ? '#d03b31' : '#d4237a';
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
      if (t - vorne > (e.tri ? tiefenToleranz(t) * 0.35 : tiefenToleranz(t))) return;
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
  hilfsGruppe.traverse((c) => { if (c.isSprite) c.scale.set(skala, skala, 1); });
  if (messGruppe) messGruppe.traverse((c) => { if (c.isSprite) c.scale.set(skala, skala, 1); });
}

function hilfenZeichnen() {
  hilfsGruppe.children.slice().forEach((c) => {
    hilfsGruppe.remove(c);
    c.traverse((o) => { if (o.material) o.material.dispose(); if (o.geometry) o.geometry.dispose(); });
  });
  S.ebenePunkte.forEach((p, i) => marker(new THREE.Vector3(...p), String(i + 1), '#e3b341'));
  S.paare.forEach((paar, i) => {
    marker(new THREE.Vector3(...paar.fest), String(i + 1), '#5cbf6a');
    if (paar.bewegt) marker(new THREE.Vector3(...paar.bewegtWelt), String(i + 1), '#e0914f');
  });
  if (S.ebenePunkte.length === 3) ebeneZeichnen();
  lochLinienZeichnen();
  koordElementeZeichnen();
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
  if (modus !== 'koord') S.koordPick = null;
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
  if (S.pickModus === 'koord') {
    const k = S.koordPick;
    status(`${{ primaer: 'Primär', sekundaer: 'Sekundär', ursprung: 'Ursprung' }[k.slot]}: Punkt ${k.punkte.length + 1} von ${k.anzahl} anklicken (Esc bricht ab).`);
  }
  if (S.pickModus === 'ebene3') status(`Schnittebene: Punkt ${S.ebenePunkte.length + 1} von 3 anklicken (rechte Maustaste dreht).`);
  if (S.pickModus === 'paare') {
    const offen = S.paare.length && !S.paare[S.paare.length - 1].bewegt;
    status(offen ? `Paar ${S.paare.length}: dieselbe Stelle auf dem BEWEGTEN Scan anklicken.` : `Paar ${S.paare.length + 1}: Stelle auf dem FESTEN Scan anklicken.`);
  }
}

function pickKlick(x, y) {
  if (S.pickModus === 'koord') {
    const p = punktAn(x, y);
    if (!p) { status('Kein Punkt getroffen.'); return; }
    const k = S.koordPick;
    k.punkte.push(p.welt.toArray());
    hilfenZeichnen();
    if (k.punkte.length < k.anzahl) { pickHinweis(); return; }
    pickModusSetzen(null);
    sicher(() => koordFormHolen(k.slot, k.art, k.punkte));
    return;
  }
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
// Netz
// ---------------------------------------------------------------------------
function aktivesNetz(pflicht = true) {
  const e = S.scans.get(S.aktiv);
  if (!e) throw new Error('Kein Scan aktiv.');
  if (pflicht && !e.tri) throw new Error(`„${e.meta.name}“ ist eine Punktwolke – erst „Netz aus Punktwolke“.`);
  return e;
}

function netzParameter(block) {
  const w = block.dataset.netz;
  const e = aktivesNetz(w !== 'erzeugen');
  const d = { werkzeug: w, id: e.id };
  block.querySelectorAll('[data-p]').forEach((el) => {
    d[el.dataset.p] = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : Number(el.value);
  });
  if (w === 'loecher') {
    if (!S.loecher || S.loecher.id !== e.id) throw new Error('Erst „Analysieren“, dann Löcher wählen.');
    d.nummern = S.loecher.liste.filter((l) => l.gewaehlt).map((l) => l.nr);
    if (!d.nummern.length) throw new Error('Kein Loch gewählt.');
  }
  if (w === 'beschneiden') {
    if (S.ebenePunkte.length !== 3) throw new Error('Erst 3 Punkte für die Schnittebene setzen.');
    d.punkte = S.ebenePunkte;
    d.umdrehen = S.ebeneUmdrehen;
  }
  return d;
}

function berichtText(b) {
  const teile = [];
  if (b.dreiecke !== undefined) teile.push(`${b.dreiecke.toLocaleString('de-DE')} Dreiecke`);
  if (b.dreiecke_vorher !== undefined) teile.push(`vorher ${b.dreiecke_vorher.toLocaleString('de-DE')}`);
  if (b.gefuellt !== undefined) teile.push(`${b.gefuellt} Löcher gefüllt`);
  return teile.join(' · ');
}

async function netzVorschau(block) {
  const d = netzParameter(block);
  const j = await api('netz/vorschau', d, 'Rechne Vorschau…');
  await netzVorschauZeigen(d.id);
  $$('section.laeuft').forEach((x) => x.classList.remove('laeuft'));
  block.classList.add('laeuft');
  const el = $('#netzErgebnis');
  el.hidden = false;
  el.className = 'ergebnis';
  el.innerHTML = `<b>Vorschau</b><br>${berichtText(j.bericht)}<br><small>${j.dauer} s · „Anwenden“ übernimmt</small>`;
}

async function netzAnwenden(block) {
  const d = netzParameter(block);
  netzVorschauWeg(d.id);
  const j = await api('netz/anwenden', d, 'Übernehme…');
  $$('section.laeuft').forEach((x) => x.classList.remove('laeuft'));
  $('#netzErgebnis').hidden = true;
  if (j.neu) { S.aktiv = j.neu; listeZeichnen(); }
  meldung(`Übernommen: ${berichtText(j.bericht)}`, 'ok');
  if (d.werkzeug === 'loecher' || d.werkzeug === 'reparieren') await netzAnalyse();
}

async function netzZuruecksetzen() {
  for (const e of S.scans.values()) netzVorschauWeg(e.id);
  $$('section.laeuft').forEach((x) => x.classList.remove('laeuft'));
  $('#netzErgebnis').hidden = true;
  await api('netz/verwerfen', {});
}

$$('[data-netz]').forEach((block) => {
  block.querySelector('[data-vorschau]').addEventListener('click', () => sicher(() => netzVorschau(block)));
  block.querySelector('[data-anwenden]').addEventListener('click', () => sicher(() => netzAnwenden(block)));
  block.querySelector('[data-zuruecksetzen]').addEventListener('click', () => sicher(netzZuruecksetzen));
});

const ANALYSE_ZEILEN = [
  ['eckpunkte', 'Eckpunkte'], ['dreiecke', 'Dreiecke'], ['teile', 'Teile', (v) => v > 1],
  ['loecher', 'Löcher / offene Ränder', (v) => v > 0], ['entartet', 'entartete Dreiecke', (v) => v > 0],
  ['doppelt', 'doppelte Dreiecke', (v) => v > 0], ['nicht_mannigfaltige_kanten', 'nicht-mannigfaltige Kanten', (v) => v > 0],
  ['nicht_mannigfaltige_punkte', 'nicht-mannigfaltige Punkte', (v) => v > 0], ['selbstschnitte', 'sich schneidende Dreiecke', (v) => v > 0],
  ['orientierbar', 'einheitlich orientierbar', (v) => v === false], ['wasserdicht', 'wasserdicht (druckbar)', (v) => v === false],
  ['flaeche', 'Oberfläche mm²'], ['volumen', 'Volumen mm³'],
];

async function netzAnalyse() {
  const e = aktivesNetz();
  const j = await api('netz/analyse', { id: e.id }, 'Analysiere Netz…');
  const tab = $('#analyseTabelle');
  tab.innerHTML = '';
  tab.dataset.fuer = `${e.id}:${e.meta.rev}`;
  for (const [k, text, schlecht] of ANALYSE_ZEILEN) {
    if (j.analyse[k] === undefined || j.analyse[k] === null) continue;
    const tr = tab.insertRow();
    let v = j.analyse[k];
    if (schlecht) tr.className = schlecht(v) ? 'schlecht' : 'gut';
    if (typeof v === 'boolean') v = v ? 'ja' : 'nein';
    else if (typeof v === 'number') v = v.toLocaleString('de-DE');
    tr.insertCell().textContent = text;
    tr.insertCell().textContent = v;
  }
  S.problem = j.problem ? { id: e.id, maske: b64.maske(j.problem, e.n) } : null;
  const liste = j.loecher.map((l) => ({ ...l, gewaehlt: false }));
  S.loecher = { id: e.id, rev: e.meta.rev, liste };
  const regler = $('#lochGrenze');
  const groesste = liste.reduce((m, l) => Math.max(m, l.umfang), 0);
  regler.max = Math.max(1, Math.ceil(groesste));
  // Standard: alle Löcher. Ist der größte Rand aber deutlich größer als der
  // Rest (> 3×), ist es bei offenen Scans der Außenrand – der bleibt offen.
  const sortiert = liste.map((l) => l.umfang).sort((a, b) => b - a);
  const aussenrand = sortiert.length > 1 && sortiert[0] > 3 * sortiert[1];
  regler.value = aussenrand ? Math.ceil(sortiert[1]) : Math.ceil(groesste);
  lochAuswahlNachGrenze();
  status(`Analyse: ${j.analyse.loecher} Löcher, ${j.analyse.teile} Teile, ${j.analyse.wasserdicht ? 'wasserdicht' : 'nicht wasserdicht'}.`);
}

function lochAuswahlNachGrenze() {
  if (!S.loecher) return;
  const g = Number($('#lochGrenze').value);
  $('#lochGrenzeText').textContent = g;
  for (const l of S.loecher.liste) l.gewaehlt = l.umfang <= g;
  lochListeZeichnen();
}

function lochListeZeichnen() {
  const box = $('#lochListe');
  box.innerHTML = '';
  if (!S.loecher) return;
  if (!S.loecher.liste.length) { box.textContent = 'Keine offenen Ränder.'; hilfenZeichnen(); return; }
  S.loecher.liste.slice().sort((a, b) => a.umfang - b.umfang).forEach((l) => {
    const lab = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = l.gewaehlt;
    cb.addEventListener('change', () => { l.gewaehlt = cb.checked; lochListeZeichnen(); });
    const t = document.createElement('span');
    t.className = l.gewaehlt ? 'gruen' : 'rot';
    t.textContent = `Umfang ${l.umfang.toLocaleString('de-DE', { maximumFractionDigits: 1 })} mm · ${l.punkte} Randpunkte`;
    lab.append(cb, t);
    box.appendChild(lab);
  });
  hilfenZeichnen();
}
$('#lochGrenze').addEventListener('input', lochAuswahlNachGrenze);

function lochLinienZeichnen() {
  if (!S.loecher) return;
  const e = S.scans.get(S.loecher.id);
  if (!e || !e.meta.sichtbar) return;
  for (const l of S.loecher.liste) {
    const pos = new Float32Array((l.indizes.length + 1) * 3);
    l.indizes.forEach((idx, i) => { pos[i * 3] = e.xyz[idx * 3]; pos[i * 3 + 1] = e.xyz[idx * 3 + 1]; pos[i * 3 + 2] = e.xyz[idx * 3 + 2]; });
    pos.set(pos.subarray(0, 3), l.indizes.length * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const linie = new THREE.Line(g, new THREE.LineBasicMaterial({ color: l.gewaehlt ? 0x5cbf6a : 0xe0584f, depthTest: false }));
    linie.renderOrder = 5;
    linie.matrixAutoUpdate = false;
    linie.matrix.copy(e.obj.matrix);
    hilfsGruppe.add(linie);
  }
}

function netzProblemeMarkieren() {
  if (!S.problem) throw new Error('Erst „Analysieren“.');
  const e = S.scans.get(S.problem.id);
  if (!e) return;
  let n = 0;
  for (let i = 0; i < e.n; i++) { e.vor[i] = S.problem.maske[i]; n += e.vor[i]; }
  alleMarkierungen();
  status(n ? `${n.toLocaleString('de-DE')} Eckpunkte an Problemstellen rot markiert – z. B. mit Auswahl löschen und Löcher schließen.` : 'Keine Problemstellen gefunden.');
}

// ---------------------------------------------------------------------------
// Achsen (Koordinatensystem)
// ---------------------------------------------------------------------------
const SLOT_FARBE = { primaer: 0x3d9be9, sekundaer: 0x5cbf6a, ursprung: 0xe0914f };
const zahlText = (v, st = 3) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: st });

function sichtbareIds() {
  const ids = sichtbareScans().map((e) => e.id);
  if (!ids.length) throw new Error('Kein sichtbarer Scan.');
  return ids;
}

async function koordFormHolen(slot, art, punkte = null) {
  if (art === 'schnitt') {
    S.koord.ursprung = { art: 'schnitt' };
    koordSlotsZeichnen();
    return;
  }
  const d = { art, punkte, ids: sichtbareIds() };
  if (!punkte) {
    d.masken = auswahlMasken();
    if (!Object.keys(d.masken).length) throw new Error('Erst Punkte auswählen (Lasso/Polygon), dann einpassen.');
  }
  const j = await api('koord/form', d, 'Passe Form ein…');
  const f = j.form;
  if (slot === 'ursprung') {
    if (f.art === 'kugel') S.koord.ursprung = { art: 'kugel', mitte: f.mitte, info: f };
    else if (f.art === 'zylinder') S.koord.ursprung = { art: 'zylinder', punkt: f.punkt, info: f };
    else S.koord.ursprung = { art: 'punkt', punkt: f.punkt, info: f };
  } else {
    S.koord[slot] = f;
  }
  if (!punkte) auswahlAlle(0);
  koordSlotsZeichnen();
}

function formText(f) {
  if (!f) return '– noch nicht festgelegt';
  const i = f.info || f;
  const rms = i.rms !== undefined && i.punkte ? ` · RMS ${zahlText(i.rms)} mm · ${i.punkte.toLocaleString('de-DE')} Pkt.` : '';
  switch (i.art) {
    case 'ebene': return `Ebene${rms}`;
    case 'zylinder': return `Zylinder Ø ${zahlText(i.radius * 2)} mm, Höhe ${zahlText(i.hoehe, 1)}${rms}`;
    case 'kugel': return `Kugel Ø ${zahlText(i.radius * 2)} mm${rms}`;
    case 'linie': return 'Linie aus 2 Punkten';
    case 'punkt': return `Punkt (${i.punkt.map((v) => zahlText(v, 2)).join(' ; ')})`;
    case 'schnitt': return 'Schnittpunkt Ebene/Achse';
    default: return i.art;
  }
}

function koordSlotsZeichnen() {
  for (const el of $$('#w-koord-321 .element')) {
    const f = S.koord[el.dataset.slot];
    el.classList.toggle('gesetzt', !!f);
    el.querySelector('[data-info]').textContent = formText(f);
  }
  hilfenZeichnen();
}

$$('#w-koord-321 .element').forEach((el) => {
  const slot = el.dataset.slot;
  el.querySelectorAll('[data-form]').forEach((b) => b.addEventListener('click', () => {
    const art = b.dataset.form;
    const anzahl = { ebene3: 3, linie2: 2, punkt: 1 }[art];
    if (anzahl) {
      S.koordPick = { slot, art, anzahl, punkte: [] };
      pickModusSetzen('koord');
      S.koordPick = { slot, art, anzahl, punkte: [] };
      pickHinweis();
    } else {
      sicher(() => koordFormHolen(slot, art));
    }
  }));
  el.querySelector('[data-umdrehen]').addEventListener('click', () => {
    const f = S.koord[slot];
    if (!f) return;
    if (f.normale) f.normale = f.normale.map((v) => -v);
    if (f.achse) f.achse = f.achse.map((v) => -v);
    if (f.art === 'linie') [f.von, f.bis] = [f.bis, f.von];
    koordSlotsZeichnen();
  });
});

function koordElementeZeichnen() {
  const k = szenenKugel();
  const r = k.radius;
  // Elemente liegen in Scan-Koordinaten: bei einer Vorschau mitbewegen
  const gruppe = new THREE.Group();
  gruppe.matrixAutoUpdate = false;
  const vorschau = S.regMatrizen && Object.values(S.regMatrizen)[0];
  if (vorschau) gruppe.matrix.set(...vorschau.flat());
  hilfsGruppe.add(gruppe);
  const hilfsZiel = { add: (o) => gruppe.add(o) };
  if (S.koordPick) S.koordPick.punkte.forEach((p, i) => marker(new THREE.Vector3(...p), String(i + 1), '#e0914f'));
  for (const slot of ['primaer', 'sekundaer', 'ursprung']) {
    const f = S.koord[slot];
    if (!f) continue;
    const farbe = SLOT_FARBE[slot];
    const i = f.info || f;
    if (slot !== 'ursprung' && i.art === 'ebene') {
      const n = new THREE.Vector3(...i.normale);
      const flaeche = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.4, r * 1.4),
        new THREE.MeshBasicMaterial({ color: farbe, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
      flaeche.position.set(...i.punkt);
      flaeche.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      hilfsZiel.add(flaeche);
      hilfsZiel.add(new THREE.ArrowHelper(n, new THREE.Vector3(...i.punkt), r * 0.35, farbe, r * 0.07, r * 0.04));
    } else if (i.art === 'zylinder' || i.art === 'linie') {
      const a = i.art === 'linie' ? new THREE.Vector3(...i.bis).sub(new THREE.Vector3(...i.von)) : new THREE.Vector3(...(f.achse || i.achse));
      const laenge = i.art === 'linie' ? a.length() : Math.max(i.hoehe * 1.6, r * 0.5);
      a.normalize();
      const mitte = i.art === 'linie' ? new THREE.Vector3(...i.von) : new THREE.Vector3(...i.punkt).addScaledVector(a, -laenge / 2);
      if (slot !== 'ursprung') hilfsZiel.add(new THREE.ArrowHelper(a, mitte, laenge, farbe, r * 0.06, r * 0.035));
      if (i.art === 'zylinder') {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(i.radius, Math.max(i.radius * 0.03, r * 0.003), 8, 48),
          new THREE.MeshBasicMaterial({ color: farbe, depthTest: false }));
        ring.position.set(...i.punkt);
        ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), a);
        ring.renderOrder = 6;
        hilfsZiel.add(ring);
      }
    }
    const punkt = f.art === 'kugel' ? f.mitte : f.art === 'punkt' || f.art === 'zylinder' ? f.punkt : null;
    if (slot === 'ursprung' && punkt) marker(new THREE.Vector3(...punkt).applyMatrix4(gruppe.matrix), '0', '#e0914f');
  }
}

async function koordVorschau(anfrage, daten, titel) {
  const ids = sichtbareIds();
  const j = await api(anfrage, { ...daten, ids, oben: S.oben }, 'Berechne Koordinatensystem…');
  const matrizen = Object.fromEntries(ids.map((id) => [id, j.matrix]));
  regVorschauSetzen(matrizen, `<b>${titel}</b><br><small>Vorschau – „Anwenden“ legt alle sichtbaren Scans ins neue Koordinatensystem.</small>`, 'gut', '#koordErgebnis');
  S.koordAktiv = true;
  einpassen();
}

async function koordAnwenden() {
  if (!S.regMatrizen) throw new Error('Erst eine Vorschau rechnen.');
  const matrizen = S.regMatrizen;
  S.regMatrizen = null;
  await api('ausrichten/anwenden', { matrizen, text: 'Koordinatensystem ausgerichtet' }, 'Wende an…');
  regZuruecksetzen(false);
  // Elemente liegen jetzt im alten System -> verwerfen
  S.koord = { primaer: null, sekundaer: null, ursprung: null };
  koordSlotsZeichnen();
  einpassen();
  meldung('Koordinatensystem übernommen.', 'ok');
}

function koordZiele() {
  const z1 = $('#w-koord-321 [data-slot=primaer] [data-ziel]').value;
  const z2 = $('#w-koord-321 [data-slot=sekundaer] [data-ziel]').value;
  if (z1 === z2) throw new Error('Primär- und Sekundärachse müssen verschieden sein.');
  return { ziel1: z1, ziel2: z2 };
}

// ---------------------------------------------------------------------------
// Formen (Geometrieerkennung)
// ---------------------------------------------------------------------------
const TYP_FARBTON = { ebene: 210, bohrung: 2, zapfen: 125, rundung: 275, hohlkehle: 300, zylinder: 25,
  zylinderflaeche: 35, kugel: 48, kugelmulde: 38, kegel: 185, senkung: 170 };
const TYP_GRUPPE = { ebene: 'Ebenen', bohrung: 'Bohrungen', zapfen: 'Zapfen / Wellen', zylinder: 'Zylinder',
  zylinderflaeche: 'Zylinderflächen', rundung: 'Rundungen', hohlkehle: 'Hohlkehlen', kugel: 'Kugeln',
  kugelmulde: 'Kugelmulden', kegel: 'Kegel', senkung: 'Senkungen' };

function hslZuRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const k = (n) => { const x = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(x - 3, 9 - x, 1)); };
  return [k(0) * 255, k(8) * 255, k(4) * 255];
}

function formFarbe(el) {
  const ton = TYP_FARBTON[el.typ] ?? 0;
  const streu = (el.id * 0.618034) % 1;
  if (el.typ === 'ebene') return hslZuRgb(ton + streu * 30 - 15, 0.25 + streu * 0.2, 0.42 + streu * 0.25);
  return hslZuRgb(ton + streu * 16 - 8, 0.75, 0.48 + streu * 0.14);
}

function erkennungUebernehmen(erk) {
  if (!erk) { S.erkennung = null; formListeZeichnen(); return; }
  const bin = atob(erk.labels);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  S.erkennung = { ...erk, labels: new Int16Array(u.buffer) };
  S.formAktiv = null;
  elementEigenschaften();
  if (S.farbModus !== 'segmente') { S.farbModus = 'segmente'; $('#farbModus').value = 'segmente'; }
  alleFarbenSetzen();
  formListeZeichnen();
}

async function formenErkennen() {
  const e = S.scans.get(S.aktiv);
  if (!e) throw new Error('Kein Scan aktiv.');
  const arten = $$('#w-formen-auto [data-art]').filter((c) => c.checked).map((c) => c.dataset.art);
  const tol = $('#formToleranz').value;
  const j = await api('formen/erkennen', { id: e.id, arten, toleranz: tol ? Number(tol) : null,
    winkel: Number($('#formWinkel').value), min_anteil: Number($('#formMin').value) }, 'Analysiere Geometrie…');
  erkennungUebernehmen(j.erkennung);
  status(`${j.erkennung.zusammenfassung} (${j.dauer} s, Toleranz ${j.erkennung.toleranz} mm)`);
}

async function formenLaden(id) {
  if (S.erkennung && S.erkennung.id === id) return;
  const j = await api('formen/laden', { id });
  if (j.erkennung) erkennungUebernehmen(j.erkennung);
  else { S.erkennung = null; formListeZeichnen(); if (S.farbModus === 'segmente') alleFarbenSetzen(); }
}

function formListeZeichnen() {
  const box = $('#formListe');
  const zus = $('#formZusammenfassung');
  const erk = S.erkennung;
  const e = erk && S.scans.get(erk.id);
  if (!erk || !e || e.meta.rev !== erk.rev) {
    box.innerHTML = '<span class="info">Noch nicht analysiert.</span>';
    zus.hidden = true;
    return;
  }
  zus.hidden = false;
  zus.className = 'ergebnis gut';
  zus.textContent = erk.zusammenfassung;
  box.innerHTML = '';
  const gruppen = {};
  for (const el of erk.elemente) (gruppen[el.typ] = gruppen[el.typ] || []).push(el);
  for (const typ of Object.keys(TYP_GRUPPE)) {
    const liste = gruppen[typ];
    if (!liste) continue;
    const kopf = document.createElement('div');
    kopf.className = 'gruppe';
    kopf.textContent = `${TYP_GRUPPE[typ]} (${liste.length})`;
    box.appendChild(kopf);
    for (const el of liste) {
      const zeile = document.createElement('div');
      zeile.className = 'el' + (S.formAktiv === el.id ? ' an' : '');
      const c = formFarbe(el).map((v) => Math.round(v));
      zeile.innerHTML = `<span class="farbe" style="background:rgb(${c})"></span><span class="text"></span><button title="Element verwerfen">✕</button>`;
      const text = zeile.querySelector('.text');
      const feld = 'durchmesser_nenn' in el ? 'durchmesser_nenn' : 'radius_nenn' in el ? 'radius_nenn' : 'winkel_nenn' in el ? 'winkel_nenn' : null;
      if (feld) {
        // Nennmaß im Text anklickbar machen
        const nenn = Number(el[feld]).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
        const teile = el.text.split(nenn);
        text.append(teile[0]);
        const span = document.createElement('span');
        span.className = 'nenn';
        span.textContent = nenn;
        span.title = 'Nennmaß ändern';
        span.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const neu = prompt('Nennmaß:', String(el[feld]).replace('.', ','));
          if (neu) sicher(async () => erkennungUebernehmen((await api('formen/nennmass', { id: erk.id, element: el.id, feld, wert: Number(neu.replace(',', '.')) })).erkennung));
        });
        text.append(span, teile.slice(1).join(nenn));
      } else {
        text.textContent = el.text;
      }
      const rms = document.createElement('div');
      rms.className = 'rms';
      rms.textContent = `RMS ${Number(el.rms).toLocaleString('de-DE', { maximumFractionDigits: 3 })} mm · ${el.punkte.toLocaleString('de-DE')} Punkte${el.manuell ? ' · von Hand' : ''}`;
      text.appendChild(rms);
      zeile.addEventListener('click', () => formWaehlen(el));
      zeile.querySelector('button').addEventListener('click', (ev) => {
        ev.stopPropagation();
        sicher(async () => erkennungUebernehmen((await api('formen/entfernen', { id: erk.id, element: el.id })).erkennung));
      });
      box.appendChild(zeile);
    }
  }
}

function formWaehlen(el, hinsehen = true) {
  const erk = S.erkennung;
  const e = S.scans.get(erk.id);
  if (!e) return;
  S.formAktiv = el.id;
  S.koerperAktiv = null;
  for (const k of S.koerper.values()) koerperDarstellung(k);
  koerperListeZeichnen();
  elementEigenschaften();
  if (WF.haupt && WF.haupt.id === 'w-grundkoerper') { gkFeldZeichnen(); gkVorschauWeg(); $('#gkInfo').textContent = ''; }
  if (WF.haupt && WF.haupt.id === 'w-skizze') skBereichZeichnen();
  if (WF.haupt && WF.haupt.id === 'w-referenz') rfFelder();
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const x of S.scans.values()) x.sel.fill(0);
  let n = 0;
  for (let i = 0; i < e.n; i++) {
    if (erk.labels[i] === el.id) { e.sel[i] = 1; box.expandByPoint(v.set(e.xyz[i * 3], e.xyz[i * 3 + 1], e.xyz[i * 3 + 2])); n++; }
  }
  alleMarkierungen();
  formListeZeichnen();
  if (!n || !hinsehen) { status(el.text); return; }
  const k = box.getBoundingSphere(new THREE.Sphere());
  const richtung = kamera.position.clone().sub(steuerung.target).normalize();
  const dist = Math.max(k.radius, 2) / Math.sin(THREE.MathUtils.degToRad(kamera.fov / 2)) * 1.6;
  steuerung.target.copy(k.center);
  kamera.position.copy(k.center).addScaledVector(richtung, dist);
  steuerung.update();
  kameraGrenzen();
  status(el.text);
}

$$('[data-form-auswahl]').forEach((b) => b.addEventListener('click', () => sicher(async () => {
  const e = S.scans.get(S.aktiv);
  if (!e) throw new Error('Kein Scan aktiv.');
  const masken = auswahlMasken();
  if (!masken[e.id]) throw new Error('Erst Punkte im aktiven Scan auswählen.');
  const j = await api('formen/auswahl', { id: e.id, masken: { [e.id]: masken[e.id] }, art: b.dataset.formAuswahl }, 'Passe Form ein…');
  auswahlAlle(0);
  erkennungUebernehmen(j.erkennung);
  const neu = j.erkennung.elemente[j.erkennung.elemente.length - 1];
  meldung(neu.text, 'ok');
})));

// ---------------------------------------------------------------------------
// Körper (OCP im Dienst): Anzeige, Modellbaum, Verlauf, Grundkörper aus Bereich
// ---------------------------------------------------------------------------
const koerperGruppe = new THREE.Group();
szene.add(koerperGruppe);
S.koerper = new Map();     // kid -> {meta, gruppe, flaeche, kanten}
S.koerperAktiv = null;
S.gkVorschau = null;       // THREE.Group der Vorschau

function b64Uint32(text) {
  const bin = atob(text);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Uint32Array(u.buffer);
}

function koerperObjekt(d, farbe, deckkraft = 1) {
  const g = new THREE.Group();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(b64.float32(d.xyz), 3));
  geo.setIndex(new THREE.BufferAttribute(b64Uint32(d.tri), 1));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const mat = new THREE.MeshStandardMaterial({ color: farbe, metalness: 0.05, roughness: 0.55, side: THREE.DoubleSide,
    transparent: deckkraft < 1, opacity: deckkraft, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const flaeche = new THREE.Mesh(geo, mat);
  g.add(flaeche);
  let kanten = null;
  if (d.kanten) {
    const kg = new THREE.BufferGeometry();
    kg.setAttribute('position', new THREE.BufferAttribute(b64.float32(d.kanten), 3));
    kanten = new THREE.LineSegments(kg, new THREE.LineBasicMaterial({ color: 0x20262d }));
    g.add(kanten);
  }
  return { gruppe: g, flaeche, kanten };
}

function koerperWeg(k) {
  koerperGruppe.remove(k.gruppe);
  k.gruppe.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
}

// --- Körper-Analyse: Zebra-Streifen (Reflexionslinien) und Formschräge ---------------
const zebraMaterial = new THREE.ShaderMaterial({
  uniforms: { dichte: { value: 18 } },
  side: THREE.DoubleSide,
  vertexShader: `varying vec3 vN; varying vec3 vV;
    void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz);
      vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float dichte; varying vec3 vN; varying vec3 vV;
    void main() { vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
      vec3 r = reflect(-normalize(vV), n);
      float s = step(0.5, fract(r.y * dichte * 0.5));
      float licht = 0.55 + 0.45 * max(dot(n, normalize(vec3(0.3, 0.5, 1.0))), 0.0);
      gl_FragColor = vec4(vec3(mix(0.08, 0.97, s)) * licht, 1.0); }`,
});
function schraegeFarben(k) {
  const geo = k.flaeche.geometry;
  const nrm = geo.getAttribute('normal').array;
  const r = $('#schraegeRichtung').value;
  const d = { z: [0, 0, 1], '-z': [0, 0, -1], y: [0, 1, 0], x: [1, 0, 0] }[r];
  const min = Math.sin((Number($('#schraegeMin').value) || 0) * Math.PI / 180);
  const n = nrm.length / 3;
  const f = new Float32Array(n * 3);
  const stat = { plus: 0, minus: 0, kritisch: 0 };
  for (let i = 0; i < n; i++) {
    const c = nrm[i * 3] * d[0] + nrm[i * 3 + 1] * d[1] + nrm[i * 3 + 2] * d[2];   // sin(Schräge)
    let rgb;
    if (c >= min) { rgb = [0.2, 0.72, 0.35]; stat.plus++; }
    else if (c <= -min) { rgb = [0.25, 0.45, 0.9]; stat.minus++; }
    else { rgb = [0.9, 0.2, 0.15]; stat.kritisch++; }
    f.set(rgb, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(f, 3));
  return stat;
}
function analyseLegende() {
  const art = $('#koerperAnalyse').value;
  const el = $('#legende');
  if (!art) { legendeZeichnen(); return; }
  el.hidden = false;
  if (art === 'zebra') {
    el.innerHTML = '<div>Zebra-Streifen</div><small>Streifen sollen über Flächengrenzen glatt weiterlaufen.<br>Knick im Streifen = Knick in der Fläche, Versatz = Sprung.</small>';
  } else {
    el.innerHTML = `<div>Formschräge zu ${$('#schraegeRichtung').selectedOptions[0].textContent}, mind. ${$('#schraegeMin').value}°</div>
      <div><span style="color:#33b85a">■</span> entformbar · <span style="color:#4073e6">■</span> Gegenseite · <span style="color:#e6331f">■</span> zu steil / Hinterschnitt-Gefahr</div>`;
  }
}
function analyseSetzen(art) {
  $('#koerperAnalyse').value = art;
  $('#zebraReihe').hidden = art !== 'zebra';
  $('#schraegeReihe').hidden = art !== 'schraege';
  for (const k of S.koerper.values()) koerperDarstellung(k);
  analyseLegende();
}

function koerperDarstellung(k) {
  const art = $('#koerperAnalyse') ? $('#koerperAnalyse').value : '';
  if (!k.normalMaterial) k.normalMaterial = k.flaeche.material;
  if (art === 'zebra') {
    zebraMaterial.uniforms.dichte.value = Number($('#zebraDichte').value) || 18;
    k.flaeche.material = zebraMaterial;
  } else {
    k.flaeche.material = k.normalMaterial;
    if (art === 'schraege') { k.schraege = schraegeFarben(k); k.normalMaterial.vertexColors = true; }
    else k.normalMaterial.vertexColors = false;
    k.normalMaterial.needsUpdate = true;
  }
  if (art === 'zebra') { k.gruppe.visible = k.meta.sichtbar; if (k.kanten) k.kanten.visible = $('#koerperKanten').checked; return; }
  const t = Number($('#koerperTransparenz').value);
  k.flaeche.material.transparent = t > 0;
  k.flaeche.material.opacity = 1 - t;
  k.flaeche.material.depthWrite = t === 0;
  k.flaeche.material.color.set(art === 'schraege' ? 0xffffff : (k.meta.kid === S.koerperAktiv ? 0x9cc3ea : 0xaeb4bc));
  if (k.kanten) k.kanten.visible = $('#koerperKanten').checked;
  k.gruppe.visible = k.meta.sichtbar;
}

async function koerperUebernehmen(liste) {
  const ids = new Set(liste.map((m) => m.id));
  for (const [kid, k] of S.koerper) if (!ids.has(kid)) { koerperWeg(k); S.koerper.delete(kid); }
  for (const meta of liste) {
    let k = S.koerper.get(meta.id);
    if (!k || k.meta.rev !== meta.rev) {
      const r = await fetch('/api/koerper/netz/' + meta.id);
      if (!r.ok) throw new Error('Körper ' + meta.name + ' nicht ladbar');
      const d = await r.json();
      if (k) koerperWeg(k);
      k = { ...koerperObjekt(d, 0xaeb4bc), meta: { ...meta, kid: meta.id } };
      k.kantenId = d.kanten_id ? b64Uint32(d.kanten_id) : null;
      k.flaechenId = d.flaechen_id ? b64Uint32(d.flaechen_id) : null;
      koerperGruppe.add(k.gruppe);
      S.koerper.set(meta.id, k);
    }
    k.meta = { ...meta, kid: meta.id };
    koerperDarstellung(k);
  }
  if (S.koerperAktiv !== null && !S.koerper.has(S.koerperAktiv)) S.koerperAktiv = null;
  koerperListeZeichnen();
  verlaufZeichnen();
  gkZielFuellen();
  kaFuellen();
  if (typeof featureAuswahlFuellen === 'function' && S.skizzen) { featureAuswahlFuellen(); knZeichnen(); kwFuellen(); }
}

function koerperWaehlen(kid) {
  S.koerperAktiv = S.koerperAktiv === kid ? null : kid;
  for (const k of S.koerper.values()) koerperDarstellung(k);
  koerperListeZeichnen();
  verlaufZeichnen();
  elementEigenschaften();
}

function koerperListeZeichnen() {
  const box = $('#koerperListe');
  if (!S.koerper.size) { box.innerHTML = '<span class="info">Noch keine Körper.</span>'; return; }
  box.innerHTML = '';
  for (const k of S.koerper.values()) {
    const m = k.meta;
    const el = document.createElement('div');
    el.className = 'koerper' + (m.id === S.koerperAktiv ? ' aktiv' : '') + (m.sichtbar ? '' : ' versteckt');
    el.innerHTML = `<button class="auge" title="Ein-/Ausblenden">${m.sichtbar ? '👁' : '◌'}</button>
      <span class="punkt" style="background:#aeb4bc;border:1px solid #6b737c"></span>
      <span class="name" title="Doppelklick zum Umbenennen"></span>
      <span class="rechts"><button class="weg" title="Körper entfernen">✕</button></span>
      <span class="zahl"></span>`;
    el.querySelector('.name').textContent = m.name;
    el.querySelector('.zahl').textContent = `Volumen ${zahlText(m.volumen || 0, 1)} mm³`;
    el.addEventListener('click', () => koerperWaehlen(m.id));
    el.querySelector('.auge').addEventListener('click', (ev) => { ev.stopPropagation(); sicher(() => api('koerper/setzen', { kid: m.id, sichtbar: !m.sichtbar })); });
    el.querySelector('.weg').addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (confirm(`Körper „${m.name}“ entfernen? (Rückgängig möglich)`)) sicher(() => api('koerper/entfernen', { kid: m.id }));
    });
    el.querySelector('.name').addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      const name = prompt('Neuer Name:', m.name);
      if (name) sicher(() => api('koerper/setzen', { kid: m.id, name }));
    });
    box.appendChild(el);
  }
}

function verlaufZeichnen() {
  const box = $('#verlaufListe');
  if (!S.koerper.size) { box.innerHTML = '<span class="info">Noch keine Modell-Schritte.</span>'; return; }
  box.innerHTML = '';
  for (const k of S.koerper.values()) {
    const kopf = document.createElement('div');
    kopf.className = 'schritt koerperKopf' + (k.meta.id === S.koerperAktiv ? ' aktiv' : '');
    kopf.innerHTML = '<span class="sym">⬢</span><span></span>';
    kopf.lastChild.textContent = k.meta.name;
    kopf.addEventListener('click', () => koerperWaehlen(k.meta.id));
    box.appendChild(kopf);
    for (const v of k.meta.verlauf || []) {
      const z = document.createElement('div');
      z.className = 'schritt unter';
      z.innerHTML = `<span class="sym">${/abgezogen/.test(v.name) ? '⊖' : /vereint/.test(v.name) ? '⊕' : '◆'}</span><span></span>`;
      z.lastChild.textContent = v.name;
      z.addEventListener('click', () => koerperWaehlen(k.meta.id));
      box.appendChild(z);
    }
  }
}

// Eigenschaften rechts: gewählter Bereich bzw. Körper
const TYP_NAME = { ebene: 'Ebene', bohrung: 'Bohrung', zapfen: 'Zapfen/Welle', zylinder: 'Zylinder', zylinderflaeche: 'Zylinderfläche',
  rundung: 'Rundung', hohlkehle: 'Hohlkehle', kugel: 'Kugel', kugelmulde: 'Kugelmulde', kegel: 'Kegel', senkung: 'Senkung' };
function vekText(v, st = 3) { return v ? v.map((x) => zahlText(x, st)).join(' ; ') : '–'; }
function elementEigenschaften() {
  const tab = $('#elementTabelle');
  const zeilen = [];
  let kopf = '';
  const k = S.koerperAktiv !== null ? S.koerper.get(S.koerperAktiv) : null;
  const erk = S.erkennung;
  const el = erk && S.formAktiv !== null ? erk.elemente.find((x) => x.id === S.formAktiv) : null;
  if (k) {
    kopf = 'Körper';
    const m = k.meta;
    zeilen.push(['Name', m.name], ['Volumen', `${zahlText(m.volumen || 0, 2)} mm³`]);
    if (m.groesse) zeilen.push(['Größe X × Y × Z', m.groesse.map((x) => zahlText(x, 2)).join(' × ') + ' mm']);
    zeilen.push(['Dreiecke (Anzeige)', (m.dreiecke || 0).toLocaleString('de-DE')], ['Schritte', String((m.verlauf || []).length)]);
  } else if (el) {
    kopf = 'Bereich';
    zeilen.push(['Typ', TYP_NAME[el.typ] || el.typ], ['Beschreibung', el.text]);
    if ('durchmesser' in el) zeilen.push(['Durchmesser', `${zahlText(el.durchmesser)} mm`]);
    if ('durchmesser_nenn' in el) zeilen.push(['Nennmaß Ø', `${zahlText(el.durchmesser_nenn)} mm`]);
    if ('radius_nenn' in el) zeilen.push(['Nennmaß R', `${zahlText(el.radius_nenn)} mm`]);
    if ('hoehe' in el) zeilen.push(['Höhe', `${zahlText(el.hoehe)} mm`]);
    if ('winkel_grad' in el) zeilen.push(['Öffnungswinkel', `${zahlText(el.winkel_grad, 2)}°`]);
    if (el.achse) zeilen.push(['Achse', vekText(el.achse)]);
    if (el.normale) zeilen.push(['Normale', vekText(el.normale)]);
    if (el.mitte) zeilen.push(['Mitte', vekText(el.mitte)]);
    else if (el.punkt) zeilen.push(['Punkt', vekText(el.punkt)]);
    if (el.ausdehnung) zeilen.push(['Ausdehnung', el.ausdehnung.map((x) => zahlText(x, 1)).join(' × ') + ' mm']);
    zeilen.push(['RMS', `${zahlText(el.rms, 4)} mm`], ['Punkte', el.punkte.toLocaleString('de-DE')]);
  }
  $('#elementEigenschaften').hidden = !zeilen.length;
  $('#elementKopf').textContent = kopf;
  tab.innerHTML = '';
  for (const [a, b] of zeilen) { const tr = tab.insertRow(); tr.insertCell().textContent = a; tr.insertCell().textContent = b; }
  $('#eigenschaftenLeer').hidden = !$('#eigenschaften').hidden || !$('#elementEigenschaften').hidden;
}

// Grundkörper aus Bereich ----------------------------------------------------
function gkElement() {
  const erk = S.erkennung;
  return erk && S.formAktiv !== null ? erk.elemente.find((x) => x.id === S.formAktiv) : null;
}
function gkFeldZeichnen() {
  const el = gkElement();
  const f = $('#gkBereich');
  f.textContent = el ? el.text : '– keiner gewählt –';
  f.classList.toggle('leer', !el);
  gkZielFuellen();
}
function gkZielFuellen() {
  const sel = $('#gkZiel');
  const alt = Number(sel.value);
  sel.innerHTML = [...S.koerper.values()].map((k) => `<option value="${k.meta.id}"></option>`).join('');
  [...sel.options].forEach((o) => { o.textContent = S.koerper.get(Number(o.value)).meta.name; });
  if (S.koerper.has(alt)) sel.value = alt;
  else if (S.koerperAktiv !== null) sel.value = S.koerperAktiv;
  const op = $('#gkOperation').value;
  sel.disabled = !(op === 'vereinen' || op === 'abziehen') || !S.koerper.size;
}
$('#gkOperation').addEventListener('change', gkZielFuellen);
function gkParameter() {
  const el = gkElement();
  if (!el) throw new Error('Erst einen Bereich wählen (links unter „Bereiche“ oder im Modell anklicken).');
  const op = $('#gkOperation').value || null;
  const ziel = op === 'vereinen' || op === 'abziehen' ? Number($('#gkZiel').value) : null;
  if ((op === 'vereinen' || op === 'abziehen') && !S.koerper.has(ziel)) throw new Error('Zielkörper wählen – es gibt noch keinen.');
  return { id: S.erkennung.id, element: el.id, nennmass: $('#gkNennmass').checked,
    verlaengern: Number($('#gkVerlaengern').value) || 0, operation: op, ziel };
}
function gkVorschauWeg() {
  if (!S.gkVorschau) return;
  koerperGruppe.remove(S.gkVorschau);
  S.gkVorschau.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  S.gkVorschau = null;
}
async function gkVorschau() {
  const j = await api('koerper/aus_form', { ...gkParameter(), vorschau: true }, 'Baue Vorschau…');
  gkVorschauWeg();
  const o = koerperObjekt(j.vorschau, 0xf08a1c, 0.55);
  o.kanten && o.kanten.material.color.set(0xb35a00);
  S.gkVorschau = o.gruppe;
  koerperGruppe.add(o.gruppe);
  $('#gkInfo').textContent = j.info.text;
}
async function gkAnwenden() {
  const j = await api('koerper/aus_form', { ...gkParameter(), vorschau: false }, 'Erzeuge Körper…');
  gkVorschauWeg();
  $('#gkInfo').textContent = '';
  if (j.koerper !== undefined && j.koerper !== null) { S.koerperAktiv = j.koerper; for (const k of S.koerper.values()) koerperDarstellung(k); koerperListeZeichnen(); verlaufZeichnen(); }
  meldung('Körper erzeugt.', 'ok');
}
// ===========================================================================
// Skizzen (Querschnitt) + Körper aus Skizze + Kanten (Etappen D/E)
// ===========================================================================
const skizzenGruppe = new THREE.Group();
koerperGruppe.add(skizzenGruppe);            // so auch beim Tiefenbild ausgeblendet
S.skizzen = new Map();      // sid -> {meta, daten, obj}
S.skizzeAktiv = null;
S.skVorschau = null;        // {daten, texte, abw, obj}
S.skHervor = null;          // [kette, element] in der Vorschau-Liste
S.featVorschau = null;      // THREE.Group (Extrusion/Drehung/Kanten)
S.knKanten = new Set();     // gewählte Kanten-Nummern (Kanten-Werkzeug)
let knGruppe = null;

async function apiRoh(name, daten = {}) {
  const r = await fetch('/api/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(daten) });
  const j = await r.json().catch(() => ({ fehler: 'Ungültige Antwort vom Dienst.' }));
  if (!r.ok || j.fehler) throw new Error(j.fehler || ('HTTP ' + r.status));
  return j;
}

function sk3d(E, s, t) {
  return new THREE.Vector3(E.ursprung[0] + s * E.u[0] + t * E.v[0], E.ursprung[1] + s * E.u[1] + t * E.v[1],
    E.ursprung[2] + s * E.u[2] + t * E.v[2]);
}
function skDiskret(el) {
  if (el.typ === 'linie') return [el.a, el.b];
  const m = el.mitte, r = el.r;
  if (el.typ === 'kreis') {
    const pts = [];
    for (let i = 0; i <= 72; i++) { const w = i / 72 * 2 * Math.PI; pts.push([m[0] + r * Math.cos(w), m[1] + r * Math.sin(w)]); }
    return pts;
  }
  const wi = (p) => Math.atan2(p[1] - m[1], p[0] - m[0]);
  const ccw = (a, b) => ((b - a) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const w0 = wi(el.a), wm = wi(el.m), w1 = wi(el.b);
  const spanne = ccw(w0, wm) <= ccw(w0, w1) ? ccw(w0, w1) : -ccw(w1, w0);
  const k = Math.max(2, Math.ceil(Math.abs(spanne) / (Math.PI / 36)) + 1);
  const pts = [];
  for (let i = 0; i < k; i++) { const w = w0 + spanne * i / (k - 1); pts.push([m[0] + r * Math.cos(w), m[1] + r * Math.sin(w)]); }
  pts[0] = el.a; pts[k - 1] = el.b;
  return pts;
}
function linienObjekt(pts3, farbe, oben = true) {
  const pos = new Float32Array((pts3.length - 1) * 6);
  for (let i = 0; i < pts3.length - 1; i++) {
    pos.set([pts3[i].x, pts3[i].y, pts3[i].z, pts3[i + 1].x, pts3[i + 1].y, pts3[i + 1].z], i * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: farbe, depthTest: !oben, transparent: oben }));
  l.renderOrder = oben ? 5 : 0;
  return l;
}
function skizzeObjekt(skz, { vorschau = false, hervor = null, abw = null } = {}) {
  const g = new THREE.Group();
  const E = skz.ebene;
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  (skz.schnitt || []).forEach((P, ki) => {
    if (!P.length) return;
    for (const q of P) { lo = [Math.min(lo[0], q[0]), Math.min(lo[1], q[1])]; hi = [Math.max(hi[0], q[0]), Math.max(hi[1], q[1])]; }
    if (vorschau) {
      const pts = P.map((q) => sk3d(E, q[0], q[1]));
      if (skz.ketten[ki] && skz.ketten[ki].geschlossen) pts.push(pts[0]);
      g.add(linienObjekt(pts, 0xe04f9a));
    }
  });
  skz.ketten.forEach((k, ki) => k.elemente.forEach((el, ei) => {
    const an = hervor && hervor[0] === ki && hervor[1] === ei;
    const farbe = an ? 0xf08a1c : (k.geschlossen ? 0x1f5fd0 : 0xc0661a);
    const o = linienObjekt(skDiskret(el).map((q) => sk3d(E, q[0], q[1])), farbe, true);
    g.add(o);
  }));
  if (vorschau && isFinite(lo[0])) {
    // Ebene als zarte Fläche um die Schnittspur
    const rand = Math.max(hi[0] - lo[0], hi[1] - lo[1]) * 0.15 + 2;
    const ecken = [[lo[0] - rand, lo[1] - rand], [hi[0] + rand, lo[1] - rand], [hi[0] + rand, hi[1] + rand], [lo[0] - rand, hi[1] + rand]]
      .map((q) => sk3d(E, q[0], q[1]));
    const geo = new THREE.BufferGeometry().setFromPoints([ecken[0], ecken[1], ecken[2], ecken[0], ecken[2], ecken[3]]);
    const f = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x6aa3ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    g.add(f);
  }
  return g;
}
function objektEntsorgen(o) {
  if (!o) return;
  if (o.parent) o.parent.remove(o);
  o.traverse((x) => { if (x.geometry) x.geometry.dispose(); if (x.material) x.material.dispose(); });
}

// --- Skizzen im Modell ----------------------------------------------------------------
async function skizzenUebernehmen(liste) {
  const ids = new Set(liste.map((m) => m.id));
  for (const [sid, z] of S.skizzen) if (!ids.has(sid)) { objektEntsorgen(z.obj); S.skizzen.delete(sid); }
  for (const meta of liste) {
    let z = S.skizzen.get(meta.id);
    if (!z || z.meta.rev !== meta.rev) {
      const j = await apiRoh('skizze/holen', { sid: meta.id });
      if (z) objektEntsorgen(z.obj);
      z = { meta, daten: j.skizze, texte: j.texte, obj: skizzeObjekt(j.skizze) };
      skizzenGruppe.add(z.obj);
      S.skizzen.set(meta.id, z);
    }
    z.meta = meta;
    z.obj.visible = meta.sichtbar;
  }
  if (S.skizzeAktiv !== null && !S.skizzen.has(S.skizzeAktiv)) S.skizzeAktiv = null;
  skizzenListeZeichnen();
  featureAuswahlFuellen();
  if (typeof v09Fuellen === 'function') v09Fuellen();
}
function skizzenListeZeichnen() {
  const box = $('#skizzenListe');
  if (!S.skizzen.size) { box.innerHTML = '<span class="info">Noch keine Skizzen.</span>'; return; }
  box.innerHTML = '';
  for (const z of S.skizzen.values()) {
    const m = z.meta;
    const el = document.createElement('div');
    el.className = 'skizze' + (m.id === S.skizzeAktiv ? ' aktiv' : '') + (m.sichtbar ? '' : ' versteckt');
    el.innerHTML = `<button class="auge" title="Ein-/Ausblenden">${m.sichtbar ? '👁' : '◌'}</button><span>✎</span>
      <span class="name" title="Doppelklick zum Umbenennen"></span><button class="weg" title="Skizze entfernen">✕</button><span class="zahl"></span>`;
    el.querySelector('.name').textContent = m.name;
    el.querySelector('.zahl').textContent = `${m.geschlossen} von ${m.ketten} Konturen geschlossen · ${m.elemente} Elemente`;
    el.addEventListener('click', () => { S.skizzeAktiv = S.skizzeAktiv === m.id ? null : m.id; skizzenListeZeichnen(); featureAuswahlFuellen(); });
    el.querySelector('.auge').addEventListener('click', (ev) => { ev.stopPropagation(); sicher(() => api('skizze/setzen', { sid: m.id, sichtbar: !m.sichtbar })); });
    el.querySelector('.weg').addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (confirm(`Skizze „${m.name}“ entfernen? (Rückgängig möglich)`)) sicher(() => api('skizze/entfernen', { sid: m.id }));
    });
    el.querySelector('.name').addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      const name = prompt('Neuer Name:', m.name);
      if (name) sicher(() => api('skizze/setzen', { sid: m.id, name }));
    });
    box.appendChild(el);
  }
}
function selectFuellen(sel, eintraege, bevorzugt = null) {
  const alt = sel.value;
  sel.innerHTML = eintraege.map(([v]) => `<option value="${v}"></option>`).join('');
  [...sel.options].forEach((o, i) => { o.textContent = eintraege[i][1]; });
  if (bevorzugt !== null && eintraege.some(([v]) => String(v) === String(bevorzugt))) sel.value = bevorzugt;
  else if (eintraege.some(([v]) => String(v) === alt)) sel.value = alt;
}
function featureAuswahlFuellen() {
  const sk = [...S.skizzen.values()].map((z) => [z.meta.id, z.meta.name]);
  const neueste = sk.length ? sk[sk.length - 1][0] : null;
  for (const id of ['#exSkizze', '#drSkizze']) selectFuellen($(id), sk, S.skizzeAktiv !== null ? S.skizzeAktiv : (document.querySelector(id).value ? null : neueste));
  const ko = [...S.koerper.values()].map((k) => [k.meta.id, k.meta.name]);
  for (const id of ['#exZiel', '#drZiel', '#knKoerper']) selectFuellen($(id), ko, $(id).value ? null : S.koerperAktiv);
  drAchsenFuellen();
  for (const [op, ziel] of [['#exOperation', '#exZiel'], ['#drOperation', '#drZiel']]) {
    const o = $(op).value;
    $(ziel).disabled = !(o === 'vereinen' || o === 'abziehen') || !S.koerper.size;
  }
  const scans = S.zustand ? S.zustand.scans : [];
  selectFuellen($('#skScan'), scans.map((x) => [x.id, x.name]), $('#skScan').value ? null : S.aktiv);
}
function drAchsenFuellen() {
  const z = S.skizzen.get(Number($('#drSkizze').value));
  const eintraege = [['', 'Achse der Skizzenebene (u)']];
  if (z) {
    let n = 0;
    z.daten.ketten.forEach((k, ki) => k.elemente.forEach((el, ei) => {
      if (el.typ === 'linie') eintraege.push([String(n), `Linie ${ki + 1}.${ei + 1} – ${z.texte[ki][ei]}`]);
      n++;
    }));
  }
  selectFuellen($('#drAchse'), eintraege);
}
$('#drSkizze').addEventListener('change', drAchsenFuellen);
for (const [op, ziel] of [['#exOperation', '#exZiel'], ['#drOperation', '#drZiel']]) {
  $(op).addEventListener('change', () => { $(ziel).disabled = !($(op).value === 'vereinen' || $(op).value === 'abziehen') || !S.koerper.size; });
}

// --- Werkzeug „Querschnitt-Skizze“ -------------------------------------------------------
function skEbeneArt() { return $('#skEbene').value; }
function skFelderZeigen() {
  const art = skEbeneArt();
  const refAchse = art.startsWith('ref:') && S.referenzen.get(Number(art.slice(4))) && S.referenzen.get(Number(art.slice(4))).art === 'achse';
  $('#skBereichBox').hidden = !(art === 'bereich' || art === 'achse');
  $('#skWinkelReihe').hidden = !(art === 'achse' || refAchse);
  $('#skVersatzReihe').hidden = art === 'achse' || refAchse;
  $('#skVersatzRegler').hidden = art === 'achse' || refAchse;
  skBereichZeichnen();
  skReglerSpanne();
}
function skBereichZeichnen() {
  const el = gkElement();
  const f = $('#skBereich');
  f.textContent = el ? el.text : '– keiner gewählt –';
  f.classList.toggle('leer', !el);
}
function skReglerSpanne() {
  // Reglerbereich = Ausdehnung des Scans entlang der Ebenennormale
  const e = S.scans.get(Number($('#skScan').value));
  if (!e) return;
  const art = skEbeneArt();
  const bb = e.geo.boundingBox;
  let lo = -50, hi = 50;
  if (art.startsWith('welt:')) {
    const k = { 'welt:xy': 'z', 'welt:xz': 'y', 'welt:yz': 'x' }[art];
    lo = bb.min[k]; hi = bb.max[k];
  } else {
    const d = bb.getSize(new THREE.Vector3()).length() / 2;
    lo = -d; hi = d;
  }
  const r = $('#skVersatzRegler');
  r.min = lo.toFixed(2); r.max = hi.toFixed(2);
  r.step = Math.max(0.01, (hi - lo) / 400).toPrecision(2);
}
$('#skEbene').addEventListener('change', skFelderZeigen);
$('#skScan').addEventListener('change', skReglerSpanne);
let skTimer = null;
$('#skVersatzRegler').addEventListener('input', () => {
  $('#skVersatz').value = Number($('#skVersatzRegler').value).toFixed(2);
  clearTimeout(skTimer);
  skTimer = setTimeout(() => sicher(skVorschau), 350);     // live mitziehen
});
$('#skVersatz').addEventListener('change', () => { $('#skVersatzRegler').value = $('#skVersatz').value; });

function skParameter() {
  const id = Number($('#skScan').value);
  if (!S.scans.has(id)) throw new Error('Erst einen Scan laden.');
  const art = skEbeneArt();
  let ebene;
  if (art.startsWith('welt:')) ebene = { art: 'welt', name: art.slice(5), versatz: Number($('#skVersatz').value) || 0 };
  else if (art.startsWith('ref:')) ebene = { art: 'referenz', rid: Number(art.slice(4)), versatz: Number($('#skVersatz').value) || 0, winkel: Number($('#skWinkel').value) || 0 };
  else {
    const el = gkElement();
    if (!el) throw new Error('Erst einen Bereich wählen (links unter „Bereiche“ oder im Modell anklicken).');
    if (S.erkennung.id !== id) throw new Error('Der gewählte Bereich gehört zu einem anderen Scan.');
    ebene = art === 'bereich' ? { art, element: el.id, versatz: Number($('#skVersatz').value) || 0 }
      : { art, element: el.id, winkel: Number($('#skWinkel').value) || 0 };
  }
  return { id, ebene, toleranz: Number($('#skTol').value) || 0.1, luecke: Number($('#skLuecke').value) || 0,
    achsen: $('#skAchsen').checked, radien: $('#skRadien').checked };
}
function skVorschauSetzen(j) {
  objektEntsorgen(S.skVorschau && S.skVorschau.obj);
  S.skVorschau = { daten: j.skizze, texte: j.texte, abw: j.abweichung };
  S.skVorschau.obj = skizzeObjekt(j.skizze, { vorschau: true, hervor: S.skHervor });
  hilfsGruppe.add(S.skVorschau.obj);
  skElementeZeichnen();
}
function skVorschauWeg() {
  if (S.skVorschau) objektEntsorgen(S.skVorschau.obj);
  S.skVorschau = null;
  S.skHervor = null;
  $('#skElemente').innerHTML = '';
  $('#skInfo').textContent = '';
}
async function skVorschau() {
  const j = await api('skizze/schnitt', skParameter(), 'Schneide und passe ein…');
  S.skHervor = null;
  skVorschauSetzen(j);
}
function skElementeZeichnen() {
  const v = S.skVorschau;
  const box = $('#skElemente');
  box.innerHTML = '';
  if (!v) return;
  const info = v.daten.info || {};
  const zu = v.daten.ketten.filter((k) => k.geschlossen).length;
  $('#skInfo').innerHTML = `${v.daten.ketten.length} Kontur(en), davon ${zu} geschlossen` +
    (info.art === 'wolke' ? ` · Scheibe ±${zahlText(info.band, 2)} mm (${info.scheibe.toLocaleString('de-DE')} Punkte)` : '') +
    (info.dauer !== undefined ? ` · ${zahlText(info.dauer, 2)} s` : '');
  v.daten.ketten.forEach((k, ki) => {
    const kopf = document.createElement('div');
    kopf.className = 'kette' + (k.geschlossen ? '' : ' offen');
    const a = v.abw[ki];
    kopf.textContent = `Kontur ${ki + 1}${k.geschlossen ? '' : ' (offen – nicht extrudierbar)'}` + (a ? ` · Abweichung zum Schnitt max ${zahlText(a.max, 3)} mm` : '');
    box.appendChild(kopf);
    k.elemente.forEach((el, ei) => {
      const z = document.createElement('div');
      z.className = 'el' + (S.skHervor && S.skHervor[0] === ki && S.skHervor[1] === ei ? ' an' : '');
      const txt = document.createElement('span');
      txt.textContent = v.texte[ki][ei] + (el.achse ? ` (${el.achse})` : '') + (el.typ !== 'linie' && el.nenn ? ' · Nennmaß' : '');
      z.appendChild(txt);
      if (el.typ !== 'linie') {
        const r = document.createElement('input');
        r.type = 'number'; r.step = '0.1'; r.min = '0.01'; r.value = String(+(el.typ === 'kreis' ? 2 * el.r : el.r).toFixed(3));
        r.title = el.typ === 'kreis' ? 'Durchmesser' : 'Radius';
        r.addEventListener('click', (ev) => ev.stopPropagation());
        r.addEventListener('change', () => sicher(async () => {
          const wert = Number(r.value);
          const j = await api('skizze/radius', { kette: ki, element: ei, r: el.typ === 'kreis' ? wert / 2 : wert }, 'Ändere Radius…');
          skVorschauSetzen(j);
        }));
        z.appendChild(r);
      } else z.appendChild(document.createElement('span'));
      const weg = document.createElement('button');
      weg.textContent = '✕';
      weg.title = el.typ === 'kreis' ? 'Kreis entfernen' : 'Durch gerade Verbindung ersetzen';
      weg.addEventListener('click', (ev) => {
        ev.stopPropagation();
        sicher(async () => { S.skHervor = null; skVorschauSetzen(await api('skizze/element_entfernen', { kette: ki, element: ei }, 'Entferne…')); });
      });
      z.appendChild(weg);
      z.addEventListener('click', () => {
        S.skHervor = S.skHervor && S.skHervor[0] === ki && S.skHervor[1] === ei ? null : [ki, ei];
        objektEntsorgen(S.skVorschau.obj);
        S.skVorschau.obj = skizzeObjekt(S.skVorschau.daten, { vorschau: true, hervor: S.skHervor });
        hilfsGruppe.add(S.skVorschau.obj);
        skElementeZeichnen();
      });
      box.appendChild(z);
    });
  });
}
async function skUebernehmen() {
  if ($('#skStapel').checked) {
    const j = await api('skizze/stapel', { ...skParameter(), von: Number($('#skVon').value) || 0, bis: Number($('#skBis').value) || 0,
      anzahl: Number($('#skAnzahl').value) || 5 }, 'Schneide mehrfach…');
    skVorschauWeg();
    await apiRoh('skizze/verwerfen', {});
    meldung(`${j.sids.length} Skizzen erzeugt` + (j.leer.length ? ` (kein Schnitt bei ${j.leer.join(', ')} mm)` : '') + ' – z. B. für Loft.', 'ok');
    return;
  }
  if (!S.skVorschau) await skVorschau();
  const j = await api('skizze/uebernehmen', {}, 'Übernehme Skizze…');
  skVorschauWeg();
  S.skizzeAktiv = j.sid;
  skizzenListeZeichnen();
  featureAuswahlFuellen();
  meldung('Skizze übernommen – jetzt Extrudieren oder Drehen.', 'ok');
}
async function skZurueck() {
  skVorschauWeg();
  await apiRoh('skizze/verwerfen', {});
}

// --- Extrudieren / Drehen -----------------------------------------------------------------------
function featVorschauWeg() { objektEntsorgen(S.featVorschau); S.featVorschau = null; }
function featVorschauZeigen(netz) {
  featVorschauWeg();
  const o = koerperObjekt(netz, 0xf08a1c, 0.55);
  o.kanten && o.kanten.material.color.set(0xb35a00);
  S.featVorschau = o.gruppe;
  koerperGruppe.add(o.gruppe);
}
function opZiel(op, ziel) {
  const o = $(op).value || null;
  const z = o === 'vereinen' || o === 'abziehen' ? Number($(ziel).value) : null;
  if ((o === 'vereinen' || o === 'abziehen') && !S.koerper.has(z)) throw new Error('Zielkörper wählen – es gibt noch keinen.');
  return { operation: o, ziel: z };
}
function exParameter() {
  const sid = Number($('#exSkizze').value);
  if (!S.skizzen.has(sid)) throw new Error('Erst eine Skizze anlegen (Querschnitt-Skizze → Übernehmen).');
  return { sid, modus: $('#exModus').value, laenge: Number($('#exLaenge').value) || 10, umkehren: $('#exUmkehren').checked,
    ...opZiel('#exOperation', '#exZiel') };
}
$('#exModus').addEventListener('change', () => { $('#exLaengeReihe').hidden = $('#exModus').value === 'auto'; });
function opText(info) {
  const ziel = info.ziel !== null && S.koerper.has(info.ziel) ? S.koerper.get(info.ziel).meta.name : '';
  return info.operation === 'neu' ? 'neuer Körper' : info.operation === 'abziehen' ? `wird von „${ziel}“ abgezogen` : `wird mit „${ziel}“ vereint`;
}
async function exVorschau() {
  const j = await api('feature/extrudieren', { ...exParameter(), vorschau: true }, 'Baue Vorschau…');
  featVorschauZeigen(j.vorschau);
  $('#exInfo').textContent = `Länge ${zahlText(j.info.laenge, 3)} mm (${zahlText(j.info.von, 3)} … ${zahlText(j.info.bis, 3)}) · ${zahlText(j.info.volumen, 1)} mm³ · ${opText(j.info)}`;
}
async function exAnwenden() {
  const j = await api('feature/extrudieren', exParameter(), 'Extrudiere…');
  featVorschauWeg();
  $('#exInfo').textContent = '';
  S.koerperAktiv = j.koerper;
  for (const k of S.koerper.values()) koerperDarstellung(k);
  koerperListeZeichnen(); verlaufZeichnen();
  meldung('Extrusion erzeugt.', 'ok');
}
function drParameter() {
  const sid = Number($('#drSkizze').value);
  if (!S.skizzen.has(sid)) throw new Error('Erst eine Skizze anlegen (Querschnitt-Skizze → Übernehmen).');
  const a = $('#drAchse').value;
  return { sid, winkel: Number($('#drWinkel').value) || 360, element: a === '' ? null : Number(a), ...opZiel('#drOperation', '#drZiel') };
}
async function drVorschau() {
  const j = await api('feature/drehen', { ...drParameter(), vorschau: true }, 'Baue Vorschau…');
  featVorschauZeigen(j.vorschau);
  $('#drInfo').textContent = `${zahlText(j.info.volumen, 1)} mm³ · ${opText(j.info)}`;
}
async function drAnwenden() {
  const j = await api('feature/drehen', drParameter(), 'Drehe…');
  featVorschauWeg();
  $('#drInfo').textContent = '';
  S.koerperAktiv = j.koerper;
  for (const k of S.koerper.values()) koerperDarstellung(k);
  koerperListeZeichnen(); verlaufZeichnen();
  meldung('Drehkörper erzeugt.', 'ok');
}

// --- Kanten runden / fasen ----------------------------------------------------------------------
function knKoerper() {
  const kid = Number($('#knKoerper').value);
  const k = S.koerper.get(kid);
  if (!k) throw new Error('Erst einen Körper erzeugen.');
  return k;
}
function knZeichnen() {
  objektEntsorgen(knGruppe);
  knGruppe = null;
  const k = S.koerper.get(Number($('#knKoerper').value));
  const n = S.knKanten.size;
  $('#knInfo').textContent = n ? `${n} Kante${n > 1 ? 'n' : ''} gewählt.` : 'Noch keine Kante gewählt – im Modell anklicken.';
  if (!k || !n || !k.kantenId) return;
  const pos = k.kanten.geometry.getAttribute('position').array;
  const wahl = [];
  for (let i = 0; i < k.kantenId.length; i++) if (S.knKanten.has(k.kantenId[i])) wahl.push(...pos.slice(i * 6, i * 6 + 6));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wahl), 3));
  knGruppe = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xf08a1c, depthTest: false, transparent: true }));
  knGruppe.renderOrder = 6;
  hilfsGruppe.add(knGruppe);
}
function kanteAn(x, y, k) {
  // naechstes Kantensegment in Bildschirm-Pixeln
  if (!k || !k.kanten || !k.kantenId) return null;
  const pos = k.kanten.geometry.getAttribute('position').array;
  const w = leinwand.clientWidth, h = leinwand.clientHeight;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  let bester = null;
  for (let i = 0; i < k.kantenId.length; i++) {
    a.set(pos[i * 6], pos[i * 6 + 1], pos[i * 6 + 2]).project(kamera);
    b.set(pos[i * 6 + 3], pos[i * 6 + 4], pos[i * 6 + 5]).project(kamera);
    if (a.z > 1 || b.z > 1) continue;
    const ax = (a.x + 1) / 2 * w, ay = (1 - a.y) / 2 * h, bx = (b.x + 1) / 2 * w, by = (1 - b.y) / 2 * h;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
    if (d < 9 && (!bester || d < bester.d)) bester = { d, id: k.kantenId[i] };
  }
  return bester;
}
function kanteKlick(x, y) {
  const k = S.koerper.get(Number($('#knKoerper').value));
  const t = kanteAn(x, y, k);
  if (!t) { status('Keine Kante an dieser Stelle – genauer auf eine Kante klicken.'); return; }
  if (S.knKanten.has(t.id)) S.knKanten.delete(t.id); else S.knKanten.add(t.id);
  featVorschauWeg();
  knZeichnen();
}
$('#knKoerper').addEventListener('change', () => { S.knKanten.clear(); featVorschauWeg(); knZeichnen(); });
function knParameter() {
  const k = knKoerper();
  if (!S.knKanten.size) throw new Error('Erst Kanten im Modell anklicken.');
  return { kid: k.meta.id, kanten: [...S.knKanten], radius: Number($('#knRadius').value) || 1 };
}
async function knVorschau() {
  const j = await api('feature/' + $('#knArt').value, { ...knParameter(), vorschau: true }, 'Baue Vorschau…');
  featVorschauZeigen(j.vorschau);
  $('#knInfo').textContent = `${S.knKanten.size} Kante(n) · Volumen danach ${zahlText(j.info.volumen, 1)} mm³`;
}
async function knAnwenden() {
  await api('feature/' + $('#knArt').value, knParameter(), $('#knArt').value === 'fasen' ? 'Fase…' : 'Runde…');
  featVorschauWeg();
  S.knKanten.clear();
  knZeichnen();
  meldung($('#knArt').value === 'fasen' ? 'Fase erzeugt.' : 'Rundung erzeugt.', 'ok');
}
async function knVorschlag() {
  const p = knParameter();
  const j = await apiRoh('feature/radius_vorschlag', p);
  if (j.radius === null) throw new Error('Im Scan wurde an diesen Kanten keine Rundung erkannt (BEREICHE → Automatisch erkennen).');
  $('#knRadius').value = j.radius;
  $('#knArt').value = 'runden';
  meldung(`Radius aus Scan: R ${zahlText(j.radius, 3)}`, 'ok');
}
function knZurueck() { featVorschauWeg(); S.knKanten.clear(); knZeichnen(); }

// --- Referenzen + Messen ---------------------------------------------------------------
const refGruppe = new THREE.Group();
szene.add(refGruppe);
var messGruppe = new THREE.Group();  // var: markerGroesse() fragt sie schon vorher ab
szene.add(messGruppe);
S.referenzen = new Map();
S.rfVorschau = null;
S.rfErste = null;
S.messung = { punkte: [], liste: [] };

function refObjekt(r, farbe = 0x8a5cd6, vorschau = false) {
  const g = new THREE.Group();
  const k = szenenKugel();
  const p = new THREE.Vector3(...r.punkt);
  if (r.art === 'ebene') {
    const n = new THREE.Vector3(...r.normale).normalize();
    const f = new THREE.Mesh(new THREE.PlaneGeometry(k.radius * 1.6, k.radius * 1.6),
      new THREE.MeshBasicMaterial({ color: farbe, transparent: true, opacity: vorschau ? 0.28 : 0.16, side: THREE.DoubleSide, depthWrite: false }));
    f.position.copy(p);
    f.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    g.add(f);
    const rand = new THREE.LineSegments(new THREE.EdgesGeometry(f.geometry), new THREE.LineBasicMaterial({ color: farbe }));
    rand.position.copy(p); rand.quaternion.copy(f.quaternion);
    g.add(rand);
  } else {
    const d = new THREE.Vector3(...r.richtung).normalize();
    const a = p.clone().addScaledVector(d, -k.radius), b = p.clone().addScaledVector(d, k.radius);
    g.add(linienObjekt([a, b], farbe, false));
  }
  return g;
}
function referenzenUebernehmen(liste) {
  for (const r of S.referenzen.values()) objektEntsorgen(r.obj);
  S.referenzen.clear();
  for (const r of liste) {
    const e = { ...r, obj: refObjekt(r) };
    e.obj.visible = r.sichtbar;
    refGruppe.add(e.obj);
    S.referenzen.set(r.id, e);
  }
  referenzListeZeichnen();
  refAuswahlFuellen();
}
function referenzListeZeichnen() {
  const box = $('#referenzListe');
  if (!S.referenzen.size) { box.innerHTML = '<span class="info">Noch keine Referenzen.</span>'; return; }
  box.innerHTML = '';
  for (const r of S.referenzen.values()) {
    const el = document.createElement('div');
    el.className = 'skizze' + (r.sichtbar ? '' : ' versteckt');
    el.innerHTML = `<button class="auge" title="Ein-/Ausblenden">${r.sichtbar ? '👁' : '◌'}</button><span>${r.art === 'ebene' ? '◇' : '│'}</span>
      <span class="name"></span><button class="weg" title="Referenz entfernen">✕</button><span class="zahl"></span>`;
    el.querySelector('.name').textContent = r.name;
    const v = r.art === 'ebene' ? r.normale : r.richtung;
    el.querySelector('.zahl').textContent = `${r.art === 'ebene' ? 'Normale' : 'Richtung'} ${v.map((x) => zahlText(x, 3)).join(' ; ')}` + (r.rms !== undefined ? ` · rms ${zahlText(r.rms, 3)}` : '');
    el.querySelector('.auge').addEventListener('click', () => sicher(() => api('referenz/setzen', { rid: r.id, sichtbar: !r.sichtbar })));
    el.querySelector('.weg').addEventListener('click', () => {
      if (confirm(`Referenz „${r.name}“ entfernen?`)) sicher(() => api('referenz/entfernen', { rid: r.id }));
    });
    box.appendChild(el);
  }
}
function refAuswahlFuellen() {
  // Skizzenebene + Spiegelebene um Referenzen ergänzen
  for (const [sel, nurEbene] of [['#skEbene', false], ['#spEbene', true]]) {
    const el = $(sel);
    const alt = el.value;
    [...el.options].filter((o) => o.value.startsWith('ref:')).forEach((o) => o.remove());
    for (const r of S.referenzen.values()) {
      if (nurEbene && r.art !== 'ebene') continue;
      const o = document.createElement('option');
      o.value = 'ref:' + r.id;
      o.textContent = r.art === 'ebene' ? `Referenz: ${r.name}` : `durch Referenzachse ${r.name}`;
      el.appendChild(o);
    }
    if ([...el.options].some((o) => o.value === alt)) el.value = alt;
  }
  const scans = S.zustand ? S.zustand.scans : [];
  selectFuellen($('#rfScan'), scans.map((x) => [x.id, x.name]), $('#rfScan').value ? null : S.aktiv);
}
function rfFelder() {
  const art = $('#rfArt').value;
  $('#rfBereichBox').hidden = art === 'symmetrie';
  $('#rfErsteBox').hidden = art !== 'mitte';
  $('#rfVersatzReihe').hidden = art !== 'bereich';
  const el = gkElement();
  $('#rfBereich').textContent = el ? el.text : '– keiner gewählt –';
  $('#rfBereich').classList.toggle('leer', !el);
  $('#rfErste').textContent = S.rfErste ? S.rfErste.text : '– noch keine –';
}
$('#rfArt').addEventListener('change', rfFelder);
function rfParameter() {
  const art = $('#rfArt').value;
  const id = Number($('#rfScan').value);
  if (!S.scans.has(id)) throw new Error('Erst einen Scan laden.');
  if (art === 'symmetrie') return ['referenz/symmetrie', { id }];
  const el = gkElement();
  if (!el) throw new Error('Erst einen Bereich wählen (links unter „Bereiche“ oder im Modell anklicken).');
  if (art === 'bereich') return ['referenz/bereich', { id: S.erkennung.id, element: el.id, versatz: Number($('#rfVersatz').value) || 0 }];
  if (!S.rfErste) throw new Error('Erst die erste Ebene merken, dann die zweite wählen.');
  return ['referenz/mitte', { id: S.erkennung.id, element: S.rfErste.id, element2: el.id }];
}
function rfVorschauWeg() { objektEntsorgen(S.rfVorschau); S.rfVorschau = null; }
async function rfVorschau() {
  const [befehl, d] = rfParameter();
  if (befehl !== 'referenz/symmetrie') { await rfAnwenden(); return; }
  const j = await api(befehl, { ...d, vorschau: true }, 'Suche Symmetrieebene…');
  rfVorschauWeg();
  S.rfVorschau = refObjekt(j.vorschau, 0xf08a1c, true);
  refGruppe.add(S.rfVorschau);
  $('#rfInfo').textContent = `Spiegel-Abweichung rms ${zahlText(j.info.rms, 3)} mm (Kandidaten: ${j.info.kandidaten.map((x) => zahlText(x, 3)).join(' / ')})`;
}
async function rfAnwenden() {
  const [befehl, d] = rfParameter();
  const j = await api(befehl, d, 'Erzeuge Referenz…');
  rfVorschauWeg();
  if (j.info) $('#rfInfo').textContent = `Spiegel-Abweichung rms ${zahlText(j.info.rms, 3)} mm`;
  meldung('Referenz erzeugt – nutzbar als Skizzen- und Spiegelebene.', 'ok');
}

// Messen
function messPunktAn(x, y) {
  const r = new THREE.Raycaster();
  r.setFromCamera(new THREE.Vector2(x / leinwand.clientWidth * 2 - 1, -(y / leinwand.clientHeight) * 2 + 1), kamera);
  const flaechen = [...S.koerper.values()].filter((k) => k.gruppe.visible).map((k) => k.flaeche);
  const t = r.intersectObjects(flaechen, false)[0];
  const p = punktAn(x, y);
  if (t && (!p || t.point.distanceTo(kamera.position) <= p.welt.distanceTo(kamera.position) + 1e-6)) return { pos: t.point.clone(), wo: 'Körper' };
  return p ? { pos: p.welt.clone(), wo: 'Scan' } : null;
}
function messKreis(a, b, c) {
  const ab = b.clone().sub(a), ac = c.clone().sub(a);
  const n = ab.clone().cross(ac);
  const n2 = n.lengthSq();
  if (n2 < 1e-12) return null;
  const m = a.clone().add(n.clone().cross(ab).multiplyScalar(ac.lengthSq()).add(ac.clone().cross(n).multiplyScalar(ab.lengthSq())).multiplyScalar(1 / (2 * n2)));
  return { mitte: m, r: m.distanceTo(a) };
}
function messZeichnen() {
  messGruppe.children.slice().forEach(objektEntsorgen);
  const zeichne = (pkte, farbe) => {
    pkte.forEach((p, i) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTextur(String(i + 1), farbe), depthTest: false, sizeAttenuation: false }));
      sp.position.copy(p); sp.renderOrder = 10;
      messGruppe.add(sp);
    });
    if (pkte.length > 1) messGruppe.add(linienObjekt(pkte, 0xd0406a, true));
  };
  for (const m of S.messung.liste) zeichne(m.punkte, '#8a5cd6');
  zeichne(S.messung.punkte, '#d0406a');
  markerGroesse();
}
function messErgebnisZeichnen() {
  const zeilen = S.messung.liste.map((m, i) => `<tr><td>${i + 1}. ${m.art}</td><td>${m.text}</td></tr>`).join('');
  $('#meErgebnis').innerHTML = zeilen ? `<table>${zeilen}</table>` : '';
  const n = { abstand: 2, winkel: 3, kreis: 3 }[$('#meArt').value];
  $('#meStand').textContent = `Punkt ${Math.min(S.messung.punkte.length + 1, n)} von ${n} anklicken.`;
}
function messKlick(x, y) {
  const t = messPunktAn(x, y);
  if (!t) { status('Hier ist weder Scan noch Körper.'); return; }
  S.messung.punkte.push(t.pos);
  const art = $('#meArt').value;
  const n = { abstand: 2, winkel: 3, kreis: 3 }[art];
  if (S.messung.punkte.length === n) {
    const [a, b, c] = S.messung.punkte;
    let text;
    if (art === 'abstand') {
      const d = b.clone().sub(a);
      text = `${zahlText(d.length(), 3)} mm (ΔX ${zahlText(d.x, 3)} · ΔY ${zahlText(d.y, 3)} · ΔZ ${zahlText(d.z, 3)})`;
    } else if (art === 'winkel') {
      const w = a.clone().sub(b).angleTo(c.clone().sub(b)) * 180 / Math.PI;
      text = `${zahlText(w, 2)}°`;
    } else {
      const k = messKreis(a, b, c);
      text = k ? `R ${zahlText(k.r, 3)} · Ø ${zahlText(2 * k.r, 3)} mm · Mitte ${[k.mitte.x, k.mitte.y, k.mitte.z].map((v) => zahlText(v, 2)).join(' ; ')}` : 'Punkte liegen auf einer Linie';
    }
    S.messung.liste.push({ art: $('#meArt').selectedOptions[0].textContent.split(' (')[0], punkte: S.messung.punkte, text });
    S.messung.punkte = [];
    meldung(text, 'ok');
  }
  messZeichnen();
  messErgebnisZeichnen();
}
$('#meArt').addEventListener('change', () => { S.messung.punkte = []; messZeichnen(); messErgebnisZeichnen(); });

// --- Freiform + Körper-Werkzeuge (v0.8) ------------------------------------------------------
S.scWahl = new Set();       // Schale: offene Flächen (Nummern)
let scGruppe = null, afLinien = null;

function kwAktiv() { return WF.haupt && WF.haupt.dataset.kw ? WF.haupt : null; }
function kwFuellen() {
  const ko = [...S.koerper.values()].map((k) => [k.meta.id, k.meta.name]);
  // vorhandene gueltige Auswahl behalten; nur leere Felder vorbelegen
  $$('.kwKoerper').forEach((sel) => selectFuellen(sel, ko, sel.value || sel.id === 'boB' || sel.id === 'beF' ? null : S.koerperAktiv));
  // zweite Auswahl moeglichst auf einen anderen Koerper stellen
  for (const [a, b] of [['#boA', '#boB'], ['#beK', '#beF']]) {
    if ($(a).value === $(b).value && ko.length > 1) {
      const anders = ko.find(([v]) => String(v) !== $(a).value);
      if (anders) $(b).value = anders[0];
    }
  }
  const scans = S.zustand ? S.zustand.scans.filter((x) => x.dreiecke > 0) : [];
  selectFuellen($('#afScan'), scans.map((x) => [x.id, `${x.name} (${x.dreiecke.toLocaleString('de-DE')} Dreiecke)`]), $('#afScan').value ? null : S.aktiv);
}
$('#muArt').addEventListener('change', () => {
  $('.muLinear').hidden = $('#muArt').value !== 'linear';
  $('.muKreis').hidden = $('#muArt').value === 'linear';
});
const zahl3 = (a, b, c) => [Number($(a).value) || 0, Number($(b).value) || 0, Number($(c).value) || 0];
function kwParameter(was) {
  const kid = (id) => {
    const v = Number($(id).value);
    if (!S.koerper.has(v)) throw new Error('Erst einen Körper erzeugen.');
    return v;
  };
  switch (was) {
    case 'bool': return { kid: kid('#boA'), kid2: kid('#boB'), art: $('#boArt').value };
    case 'verschieben': return { kid: kid('#vsK'), versatz: zahl3('#vsX', '#vsY', '#vsZ'), drehung: zahl3('#vsRX', '#vsRY', '#vsRZ'), kopie: $('#vsKopie').checked };
    case 'spiegeln': return { kid: kid('#spK'), ebene: $('#spEbene').value, durch: $('#spDurch').value, vereinen: $('#spVereinen').checked };
    case 'muster': return { kid: kid('#muK'), art: $('#muArt').value, anzahl: Number($('#muAnzahl').value) || 3,
      versatz: zahl3('#muX', '#muY', '#muZ'), achse: $('#muAchse').value, winkel: Number($('#muWinkel').value) || 360 };
    case 'schale': return { kid: kid('#scK'), dicke: Number($('#scDicke').value) || 2, flaechen: [...S.scWahl] };
    case 'aufdicken': return { kid: kid('#adK'), dicke: Number($('#adDicke').value) || 2 };
    case 'schneiden_flaeche': return { kid: kid('#beK'), fid: kid('#beF'), behalten: $('#beSeite').value };
  }
  throw new Error('Unbekanntes Werkzeug');
}
function kwInfoText(info) {
  const t = [];
  if (info.volumen !== undefined) t.push(`Volumen ${zahlText(info.volumen, 1)} mm³`);
  if (info.flaeche !== undefined) t.push(`Oberfläche ${zahlText(info.flaeche, 1)} mm²`);
  return t.join(' · ');
}
async function kwVorschau() {
  const h = kwAktiv(); if (!h) return;
  const j = await api('feature/' + h.dataset.kw, { ...kwParameter(h.dataset.kw), vorschau: true }, 'Baue Vorschau…');
  featVorschauZeigen(j.vorschau);
  h.querySelector('.kwInfo').textContent = 'Vorschau: ' + kwInfoText(j.info);
}
async function kwAnwenden() {
  const h = kwAktiv(); if (!h) return;
  const j = await api('feature/' + h.dataset.kw, kwParameter(h.dataset.kw), 'Wende an…');
  featVorschauWeg();
  h.querySelector('.kwInfo').textContent = '';
  if (j.koerper !== undefined) S.koerperAktiv = j.koerper;
  for (const k of S.koerper.values()) koerperDarstellung(k);
  koerperListeZeichnen(); verlaufZeichnen();
  if (h.id === 'w-schale') { S.scWahl.clear(); scZeichnen(); }
  meldung((h.dataset.titel || 'Werkzeug') + ' angewendet.', 'ok');
}
function kwZurueck() {
  featVorschauWeg();
  if (afLinien) { objektEntsorgen(afLinien); afLinien = null; }
  S.kaefig = null;
  document.querySelectorAll('.kwInfo').forEach((e) => { e.textContent = ''; });
  $('#flInfo').textContent = '';
  S.scWahl.clear(); scZeichnen();
}

// Schale: Flächen per Klick wählen (Dreieck -> Flächen-Nummer)
function scZeichnen() {
  objektEntsorgen(scGruppe); scGruppe = null;
  const k = S.koerper.get(Number($('#scK').value));
  const info = WF.haupt && WF.haupt.id === 'w-schale' ? WF.haupt.querySelector('.kwInfo') : null;
  if (info) info.textContent = S.scWahl.size ? `${S.scWahl.size} Fläche(n) bleiben offen.` : 'Keine Fläche gewählt → geschlossen hohl.';
  if (!k || !S.scWahl.size || !k.flaechenId) return;
  const pos = k.flaeche.geometry.getAttribute('position').array, idx = k.flaeche.geometry.index.array;
  const wahl = [];
  for (let t = 0; t < k.flaechenId.length; t++) if (S.scWahl.has(k.flaechenId[t])) for (let e = 0; e < 3; e++) wahl.push(...pos.slice(idx[t * 3 + e] * 3, idx[t * 3 + e] * 3 + 3));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wahl), 3));
  scGruppe = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xf08a1c, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthTest: false }));
  scGruppe.renderOrder = 6;
  hilfsGruppe.add(scGruppe);
}
function flaecheKlick(x, y) {
  const k = S.koerper.get(Number($('#scK').value));
  if (!k || !k.flaechenId) return;
  const r = new THREE.Raycaster();
  r.setFromCamera(new THREE.Vector2(x / leinwand.clientWidth * 2 - 1, -(y / leinwand.clientHeight) * 2 + 1), kamera);
  const t = r.intersectObject(k.flaeche, false)[0];
  if (!t) { status('Keine Fläche des Körpers an dieser Stelle.'); return; }
  const id = k.flaechenId[t.faceIndex];
  if (S.scWahl.has(id)) S.scWahl.delete(id); else S.scWahl.add(id);
  featVorschauWeg();
  scZeichnen();
}
$('#scK').addEventListener('change', () => { S.scWahl.clear(); scZeichnen(); });

// Automatische Flächen
async function afVorschau() {
  const id = Number($('#afScan').value);
  if (!S.scans.has(id)) throw new Error('Erst ein Dreiecksnetz laden (oder Punktwolke vernetzen).');
  const j = await api('freiform/auto', { id, flaechen: Number($('#afAnzahl').value) || 400, kantenwinkel: Number($('#afKante').value) || 0, vorschau: true }, 'Lege Vierecksnetz…');
  S.kaefig = { V: b64.float32(j.V), F: b64Uint32(j.F), scan: id, geaendert: false };
  kaefigLinien();
  $('#afInfo').textContent = `${j.vierecke} Vierecke – so viele Flächen entstehen.`;
}
async function afAnwenden() {
  const id = Number($('#afScan').value);
  if (!S.scans.has(id)) throw new Error('Erst ein Dreiecksnetz laden (oder Punktwolke vernetzen).');
  const kaefig = S.kaefig && S.kaefig.geaendert && S.kaefig.scan === id ? { V: zuB64(S.kaefig.V), F: zuB64(S.kaefig.F) } : null;
  const j = await api('freiform/auto', { id, flaechen: Number($('#afAnzahl').value) || 400, raster: Number($('#afRaster').value) || 9,
    kantenwinkel: Number($('#afKante').value) || 0, glatt: $('#afGlatt').checked, kaefig }, 'Erzeuge Flächen…');
  if (afLinien) { objektEntsorgen(afLinien); afLinien = null; }
  S.kaefig = null;
  const i = j.info;
  $('#afInfo').innerHTML = `${i.vierecke} Flächen in ${zahlText(i.dauer, 1)} s · ${i.geschlossen ? '<b>geschlossener Volumenkörper</b>' : `offene Fläche (${i.freie_kanten} freie Kanten)`}<br>
    Abweichung zum Scan: Median ${zahlText(i.median, 3)} · 95 % unter ${zahlText(i.p95, 3)} · max ${zahlText(i.max, 3)} mm<br>
    Knick zwischen Flächen: Mittel ${zahlText(i.knick_mittel, 2)}° · 95 % unter ${zahlText(i.knick_p95, 2)}°` +
    (i.scharfe_kanten ? ` (ohne ${i.scharfe_kanten} scharfe Bauteilkanten)` : '') +
    (i.kantig ? '<br><span class="offen">Kantiges Teil – besser über Querschnitt-Skizze, Extrudieren und Grundkörper aufbauen; automatische Flächen sind für organische Formen.</span>'
      : i.p95 > 0.2 ? '<br><span class="offen">Grob – mehr Flächen wählen.</span>' : '');
  S.koerperAktiv = j.koerper;
  for (const k of S.koerper.values()) koerperDarstellung(k);
  koerperListeZeichnen(); verlaufZeichnen();
  meldung('Freiform-Körper erzeugt.', 'ok');
}
async function flVorschau() {
  const masken = auswahlMasken();
  if (!Object.keys(masken).length) throw new Error('Erst Punkte auswählen (Rechteck oder Lasso).');
  const j = await api('freiform/flaeche', { masken, verlaengern: Number($('#flVerl').value) || 0, raster: Number($('#flRaster').value) || 0, vorschau: true }, 'Passe Fläche ein…');
  featVorschauZeigen(j.vorschau);
  $('#flInfo').textContent = `${j.info.punkte.toLocaleString('de-DE')} Punkte · Raster ${j.info.raster.join(' × ')} · Abweichung Median ${zahlText(j.info.median, 3)}, 95 % unter ${zahlText(j.info.p95, 3)} mm`;
}
async function flAnwenden() {
  const masken = auswahlMasken();
  if (!Object.keys(masken).length) throw new Error('Erst Punkte auswählen (Rechteck oder Lasso).');
  const j = await api('freiform/flaeche', { masken, verlaengern: Number($('#flVerl').value) || 0, raster: Number($('#flRaster').value) || 0 }, 'Erzeuge Fläche…');
  featVorschauWeg();
  S.koerperAktiv = j.koerper;
  for (const k of S.koerper.values()) koerperDarstellung(k);
  koerperListeZeichnen(); verlaufZeichnen();
  meldung('Fläche erzeugt – z. B. „Mit Fläche schneiden“ oder „Aufdicken“.', 'ok');
}

// --- Loft / Sweep / Rohr / Abwickeln / Käfig (v0.9) ---------------------------------------------
S.kaefig = null;            // {V: Float32Array, F: Uint32Array, scan, geaendert}
S.awWahl = new Set();
let kaefigZug = null, awGruppe = null, awLetztes = null;

function zuB64(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function v09Fuellen() {
  const sk = [...S.skizzen.values()].map((z) => [z.meta.id, z.meta.name]);
  selectFuellen($('#swProfil'), sk);
  selectFuellen($('#swPfad'), sk, $('#swPfad').value ? null : (sk.length > 1 ? sk[sk.length - 1][0] : null));
  const ko = [...S.koerper.values()].map((k) => [k.meta.id, k.meta.name]);
  for (const id of ['#loZiel', '#swZiel']) selectFuellen($(id), ko, $(id).value ? null : S.koerperAktiv);
  const box = $('#loListe');
  const alt = new Set([...box.querySelectorAll('input:checked')].map((e) => Number(e.value)));
  box.innerHTML = sk.length ? '' : '<span class="info">Noch keine Skizzen.</span>';
  for (const [id, name] of sk) {
    const z = document.createElement('label');
    z.className = 'el';
    z.innerHTML = `<span><input type="checkbox" value="${id}"> </span><span></span><span></span>`;
    z.querySelector('span').append(name);
    if (alt.has(id)) z.querySelector('input').checked = true;
    box.appendChild(z);
  }
}
$('#swArt').addEventListener('change', () => {
  $('#swProfilReihe').hidden = $('#swArt').value !== 'sweep';
  $('#swRohrReihe').hidden = $('#swArt').value !== 'pipe';
});
$('#skStapel').addEventListener('change', () => { $('#skStapelReihe').hidden = !$('#skStapel').checked; });

async function loAusfuehren(vorschau) {
  const sids = [...$('#loListe').querySelectorAll('input:checked')].map((e) => Number(e.value));
  if (sids.length < 2) throw new Error('Mindestens zwei Skizzen anhaken.');
  const j = await api('feature/loft', { sids, glatt: $('#loGlatt').checked, vorschau, ...opZiel('#loOperation', '#loZiel') }, vorschau ? 'Baue Vorschau…' : 'Erzeuge Loft…');
  if (vorschau) { featVorschauZeigen(j.vorschau); $('#loInfo').textContent = `${zahlText(j.info.volumen, 1)} mm³ · ${opText(j.info)}`; return; }
  featVorschauWeg(); $('#loInfo').textContent = '';
  S.koerperAktiv = j.koerper; for (const k of S.koerper.values()) koerperDarstellung(k);
  koerperListeZeichnen(); verlaufZeichnen(); meldung('Loft erzeugt.', 'ok');
}
async function swAusfuehren(vorschau) {
  const pfad = Number($('#swPfad').value);
  if (!S.skizzen.has(pfad)) throw new Error('Erst eine Pfad-Skizze anlegen.');
  const art = $('#swArt').value;
  const d = art === 'sweep' ? { profil: Number($('#swProfil').value), pfad }
    : { pfad, radius: Number($('#swRadius').value) || 2, innen: Number($('#swInnen').value) || 0 };
  if (art === 'sweep' && d.profil === pfad) throw new Error('Profil und Pfad müssen verschiedene Skizzen sein.');
  const j = await api('feature/' + art, { ...d, vorschau, ...opZiel('#swOperation', '#swZiel') }, vorschau ? 'Baue Vorschau…' : 'Erzeuge…');
  if (vorschau) { featVorschauZeigen(j.vorschau); $('#swInfo').textContent = `${zahlText(j.info.volumen, 1)} mm³ · ${opText(j.info)}`; return; }
  featVorschauWeg(); $('#swInfo').textContent = '';
  S.koerperAktiv = j.koerper; for (const k of S.koerper.values()) koerperDarstellung(k);
  koerperListeZeichnen(); verlaufZeichnen(); meldung(art === 'sweep' ? 'Sweep erzeugt.' : 'Rohr erzeugt.', 'ok');
}

// Abwickeln: Flächen wählen, 2D-Vorschau, SVG
function awZeichnenWahl() {
  objektEntsorgen(awGruppe); awGruppe = null;
  const k = S.koerper.get(Number($('#awK').value));
  if (!k || !S.awWahl.size || !k.flaechenId) return;
  const pos = k.flaeche.geometry.getAttribute('position').array, idx = k.flaeche.geometry.index.array;
  const wahl = [];
  for (let t = 0; t < k.flaechenId.length; t++) if (S.awWahl.has(k.flaechenId[t])) for (let e = 0; e < 3; e++) wahl.push(...pos.slice(idx[t * 3 + e] * 3, idx[t * 3 + e] * 3 + 3));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wahl), 3));
  awGruppe = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x4f9de0, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthTest: false }));
  awGruppe.renderOrder = 6;
  hilfsGruppe.add(awGruppe);
}
function awKlick(x, y) {
  const k = S.koerper.get(Number($('#awK').value));
  if (!k || !k.flaechenId) return;
  const r = new THREE.Raycaster();
  r.setFromCamera(new THREE.Vector2(x / leinwand.clientWidth * 2 - 1, -(y / leinwand.clientHeight) * 2 + 1), kamera);
  const t = r.intersectObject(k.flaeche, false)[0];
  if (!t) return;
  const id = k.flaechenId[t.faceIndex];
  if (S.awWahl.has(id)) S.awWahl.delete(id); else S.awWahl.add(id);
  awZeichnenWahl();
  $('#awInfo').textContent = `${S.awWahl.size} Fläche(n) gewählt.`;
}
$('#awK').addEventListener('change', () => { S.awWahl.clear(); awZeichnenWahl(); });
async function awVorschau() {
  const k = S.koerper.get(Number($('#awK').value));
  if (!k) throw new Error('Erst einen Körper erzeugen.');
  const j = await api('feature/abwickeln', { kid: k.meta.id, flaechen: [...S.awWahl] }, 'Wickle ab…');
  awLetztes = j;
  const c = $('#awBild');
  c.hidden = false;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  const [b, h] = j.info.groesse;
  const m = Math.min((c.width - 10) / Math.max(b, 1e-6), (c.height - 10) / Math.max(h, 1e-6));
  g.strokeStyle = '#1f5fd0'; g.lineWidth = 1;
  for (const um of j.umriss) {
    g.beginPath();
    um.forEach(([x, y], i) => { const px = 5 + x * m, py = c.height - 5 - y * m; if (i) g.lineTo(px, py); else g.moveTo(px, py); });
    g.closePath(); g.stroke();
  }
  const v = j.info.verzerrung_max;
  $('#awInfo').innerHTML = `${zahlText(b, 2)} × ${zahlText(h, 2)} mm · Fläche ${zahlText(j.info.flaeche, 1)} mm² · Verzerrung ${v < 0.001 ? 'keine (abwickelbar)' : `mittel ${zahlText(100 * j.info.verzerrung_mittel, 1)} %, max ${zahlText(100 * v, 1)} %`}`;
}
function awSvg() {
  if (!awLetztes) throw new Error('Erst abwickeln.');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([awLetztes.svg], { type: 'image/svg+xml' }));
  a.download = 'abwicklung.svg';
  document.body.appendChild(a); a.click(); a.remove();
}

// Käfig von Hand: Ecken über den Scan ziehen
function kaefigLinien() {
  if (afLinien) objektEntsorgen(afLinien);
  const { V, F } = S.kaefig;
  const pos = new Float32Array(F.length * 2 * 3);
  for (let f = 0; f < F.length / 4; f++) for (let e = 0; e < 4; e++) {
    const a = F[f * 4 + e], b = F[f * 4 + (e + 1) % 4], o = (f * 4 + e) * 6;
    pos.set([V[a * 3], V[a * 3 + 1], V[a * 3 + 2], V[b * 3], V[b * 3 + 1], V[b * 3 + 2]], o);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  afLinien = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: S.kaefig.geaendert ? 0xd0406a : 0x1f5fd0 }));
  hilfsGruppe.add(afLinien);
}
function kaefigEckeAn(x, y) {
  const { V } = S.kaefig;
  const w = leinwand.clientWidth, h = leinwand.clientHeight, v = new THREE.Vector3();
  let best = null;
  for (let i = 0; i < V.length / 3; i++) {
    v.set(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]).project(kamera);
    if (v.z > 1) continue;
    const d = Math.hypot((v.x + 1) / 2 * w - x, (1 - v.y) / 2 * h - y);
    if (d < 10 && (!best || d < best.d)) best = { d, i };
  }
  return best ? best.i : null;
}
leinwand.addEventListener('pointerdown', (ev) => {
  if (!S.kaefig || !WF.haupt || WF.haupt.id !== 'w-auto-flaechen' || ev.button !== 0 || S.beschaeftigt) return;
  const [x, y] = lokalePos(ev);
  const i = kaefigEckeAn(x, y);
  if (i === null) return;
  ev.stopImmediatePropagation(); ev.preventDefault();
  steuerung.enabled = false;
  kaefigZug = i;
  leinwand.setPointerCapture(ev.pointerId);
}, { capture: true });
leinwand.addEventListener('pointermove', (ev) => {
  if (kaefigZug === null) return;
  const [x, y] = lokalePos(ev);
  const p = punktAn(x, y, S.kaefig.scan);
  if (!p) return;
  S.kaefig.V.set([p.welt.x, p.welt.y, p.welt.z], kaefigZug * 3);
  S.kaefig.geaendert = true;
  kaefigLinien();
});
leinwand.addEventListener('pointerup', () => {
  if (kaefigZug === null) return;
  kaefigZug = null;
  steuerung.enabled = true;
  $('#afInfo').textContent = 'Käfig von Hand geändert – „Erzeugen“ übernimmt ihn.';
});

// --- Abweichung Scan <-> Koerper --------------------------------------------------
function kaFuellen() {
  const scans = S.zustand ? S.zustand.scans : [];
  const sel = $('#kaScan'), alt = Number(sel.value);
  sel.innerHTML = scans.map((s) => `<option value="${s.id}"></option>`).join('');
  [...sel.options].forEach((o, i) => { o.textContent = scans[i].name; });
  if (scans.some((s) => s.id === alt)) sel.value = alt; else if (S.aktiv) sel.value = S.aktiv;
  const kSel = $('#kaKoerper'), kAlt = kSel.value;
  kSel.innerHTML = '<option value="">alle sichtbaren</option>' +
    [...S.koerper.values()].map((k) => `<option value="${k.meta.id}"></option>`).join('');
  [...kSel.options].slice(1).forEach((o) => { o.textContent = S.koerper.get(Number(o.value)).meta.name; });
  if ([...kSel.options].some((o) => o.value === kAlt)) kSel.value = kAlt;
}
async function kaZeigen() {
  if (!S.koerper.size) throw new Error('Noch keine Körper – erst einen Grundkörper erzeugen (MODELL → Grundkörper).');
  const id = Number($('#kaScan').value);
  if (!S.scans.has(id)) throw new Error('Erst einen Scan laden.');
  const kid = $('#kaKoerper').value === '' ? null : Number($('#kaKoerper').value);
  const max = Math.max(0.001, Number($('#kaMax').value) || 0.5);
  const tol = Math.max(0, Number($('#kaTol').value) || 0);
  const aus = Math.max(0, Number($('#kaAus').value) || 0);
  const j = await api('koerper/abweichung', { id, kid, toleranz: tol, ausblenden: aus }, 'Berechne Abweichung…');
  S.abweichung = { id, koerper: true, werte: b64.float32(j.werte), max, tol, aus, kennwerte: j.kennwerte };
  alleFarbenSetzen();
  const k = j.kennwerte;
  $('#kaInfo').innerHTML = k.anzahl
    ? `<table>
      <tr><td>Mittel</td><td>${k.mittel.toFixed(3)} mm</td></tr>
      <tr><td>Std-Abw. σ</td><td>${k.std.toFixed(3)} mm</td></tr>
      <tr><td>RMS</td><td>${k.rms.toFixed(3)} mm</td></tr>
      <tr><td>Min / Max</td><td>${k.min.toFixed(3)} / ${k.max.toFixed(3)} mm</td></tr>
      <tr><td>95 % unter</td><td>${k.p95.toFixed(3)} mm</td></tr>
      <tr><td>in ±${tol} mm</td><td>${k.in_toleranz.toFixed(1)} %</td></tr>
      <tr><td>ohne Gegenstück</td><td>${k.ohne_gegenstueck.toLocaleString('de-DE')} Punkte</td></tr></table>`
    : `Kein Punkt näher als ${aus} mm am Körper – liegen Scan und Körper übereinander?`;
  meldung('Abweichungskarte berechnet.', 'ok');
}
function kaAus() {
  if (S.abweichung && S.abweichung.koerper) { S.abweichung = null; alleFarbenSetzen(); }
  $('#kaInfo').textContent = '';
}

function koerperExport(format) {
  if (!S.koerper.size) throw new Error('Noch keine Körper – erst einen Grundkörper erzeugen.');
  const ziel = S.koerperAktiv !== null ? S.koerperAktiv : 'alle';
  herunterladen(`/api/koerper/export/${ziel}?format=${format}`);
  konsole(`Export ${format.toUpperCase()}: ${ziel === 'alle' ? 'alle Körper' : S.koerper.get(ziel).meta.name}`, 'ok');
}
$('#koerperKanten').addEventListener('change', () => { for (const k of S.koerper.values()) koerperDarstellung(k); });
$('#koerperAnalyse').addEventListener('change', () => analyseSetzen($('#koerperAnalyse').value));
for (const id of ['#zebraDichte', '#schraegeRichtung', '#schraegeMin']) {
  $(id).addEventListener('input', () => { for (const k of S.koerper.values()) koerperDarstellung(k); analyseLegende(); });
}
$('#koerperTransparenz').addEventListener('input', () => { for (const k of S.koerper.values()) koerperDarstellung(k); });

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

function regVorschauSetzen(matrizen, ergebnisHtml, guete, ziel = '#regErgebnis') {
  regZuruecksetzen(false);
  S.regMatrizen = matrizen;
  for (const [id, T] of Object.entries(matrizen)) {
    const e = S.scans.get(Number(id));
    if (e) matrixSetzen(e, T);
  }
  const el = $(ziel);
  el.hidden = false;
  el.className = 'ergebnis ' + (guete || '');
  el.innerHTML = ergebnisHtml;
  hilfenZeichnen();
}

function regZuruecksetzen(meldungZeigen = true) {
  S.regMatrizen = null;
  for (const e of S.scans.values()) matrixSetzen(e, null);
  $('#regErgebnis').hidden = true;
  $('#koordErgebnis').hidden = true;
  if (S.abweichung) { S.abweichung = null; alleFarbenSetzen(); }
  hilfenZeichnen();
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
    const gewaehlt = [...S.scans.values()].some((e) => e.sel.some((x) => x));
    if (!gewaehlt && !$('#werkzeugfenster').hidden) { werkzeugSchliessen(true); return; }
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
  netzAnalyse: { text: 'Netz analysieren', fn: netzAnalyse },
  formenErkennen: { text: 'Formen erkennen', taste: 'Ctrl+R', fn: formenErkennen },
  formenCsv: { text: 'Elementliste als CSV', fn: () => {
    if (!S.erkennung) throw new Error('Erst analysieren.');
    herunterladen('/api/formen/csv/' + S.erkennung.id);
  } },
  koordEbene: { text: 'Auf größte Ebene stellen', fn: () => koordVorschau('koord/auto', { art: 'ebene', ursprung: $('#autoUrsprung').value }, 'Auf größte Ebene gestellt') },
  koordHaupt: { text: 'Hauptachsen ausrichten', fn: () => koordVorschau('koord/auto', { art: 'hauptachsen', ursprung: $('#autoUrsprung').value === 'unten' ? 'unten' : $('#autoUrsprung').value }, 'Hauptachsen') },
  koordElemente: { text: '3-2-1 Vorschau', fn: () => {
    if (!S.koord.primaer || !S.koord.sekundaer) throw new Error('Primär- und Sekundärelement festlegen.');
    return koordVorschau('koord/elemente', { primaer: S.koord.primaer, sekundaer: S.koord.sekundaer, ursprung: S.koord.ursprung, ...koordZiele() }, '3-2-1-Ausrichtung');
  } },
  koordWerte: { text: 'Um Werte verschieben/drehen', fn: () => koordVorschau('koord/werte', {
    verschieben: ['#wertVX', '#wertVY', '#wertVZ'].map((q) => Number($(q).value)),
    drehen: ['#wertDX', '#wertDY', '#wertDZ'].map((q) => Number($(q).value)),
  }, 'Verschoben/gedreht') },
  koordAnwenden: { text: 'Koordinatensystem anwenden', fn: koordAnwenden },
  koordZurueck: { text: 'Koordinaten-Vorschau zurücksetzen', fn: () => regZuruecksetzen() },
  koordLeeren: { text: 'Elemente leeren', fn: () => { S.koord = { primaer: null, sekundaer: null, ursprung: null }; koordSlotsZeichnen(); } },
  netzProbleme: { text: 'Problemstellen markieren', fn: netzProblemeMarkieren },
  gkVorschau: { text: 'Grundkörper: Vorschau', fn: gkVorschau },
  gkAnwenden: { text: 'Grundkörper erzeugen', fn: gkAnwenden },
  gkZurueck: { text: '', fn: () => { gkVorschauWeg(); $('#gkInfo').textContent = ''; } },
  grundkoerper: { text: 'Werkzeug: Grundkörper aus Bereich', taste: 'G', fn: () => werkzeugOeffnen('w-grundkoerper', $('[data-bandseite=modell] [data-wf=w-grundkoerper]')) },
  kaZeigen: { text: 'Abweichung Scan ↔ Körper', fn: kaZeigen },
  skVorschau: { text: 'Querschnitt-Skizze: Vorschau', fn: skVorschau },
  skUebernehmen: { text: 'Skizze übernehmen', fn: skUebernehmen },
  skZurueck: { text: '', fn: skZurueck },
  exVorschau: { text: 'Extrudieren: Vorschau', fn: exVorschau },
  exAnwenden: { text: 'Extrudieren', fn: exAnwenden },
  exZurueck: { text: '', fn: () => { featVorschauWeg(); $('#exInfo').textContent = ''; } },
  drVorschau: { text: 'Drehen: Vorschau', fn: drVorschau },
  drAnwenden: { text: 'Drehen', fn: drAnwenden },
  drZurueck: { text: '', fn: () => { featVorschauWeg(); $('#drInfo').textContent = ''; } },
  knVorschau: { text: 'Kanten: Vorschau', fn: knVorschau },
  knAnwenden: { text: 'Kanten runden/fasen', fn: knAnwenden },
  knVorschlag: { text: 'Radius aus Scan', fn: knVorschlag },
  knZurueck: { text: '', fn: knZurueck },
  kwVorschau: { text: 'Vorschau', fn: kwVorschau },
  rfVorschau: { text: 'Referenz: Vorschau', fn: rfVorschau },
  loVorschau: { text: 'Loft: Vorschau', fn: () => loAusfuehren(true) },
  loAnwenden: { text: 'Loft', fn: () => loAusfuehren(false) },
  loZurueck: { text: '', fn: () => { featVorschauWeg(); $('#loInfo').textContent = ''; } },
  swVorschau: { text: 'Sweep/Rohr: Vorschau', fn: () => swAusfuehren(true) },
  swAnwenden: { text: 'Sweep/Rohr', fn: () => swAusfuehren(false) },
  swZurueck: { text: '', fn: () => { featVorschauWeg(); $('#swInfo').textContent = ''; } },
  awVorschau: { text: 'Abwickeln', fn: awVorschau },
  awSvg: { text: 'Abwicklung als SVG', fn: awSvg },
  awZurueck: { text: '', fn: () => { S.awWahl.clear(); awZeichnenWahl(); awLetztes = null; $('#awBild').hidden = true; $('#awInfo').textContent = ''; } },
  rfAnwenden: { text: 'Referenz erzeugen', fn: rfAnwenden },
  rfZurueck: { text: '', fn: () => { rfVorschauWeg(); $('#rfInfo').textContent = ''; } },
  rfErsteMerken: { text: '', fn: () => { const el = gkElement(); if (!el) throw new Error('Erst eine Ebene wählen.'); S.rfErste = el; rfFelder(); } },
  meNeu: { text: '', fn: () => { S.messung.punkte = []; messZeichnen(); messErgebnisZeichnen(); } },
  meZurueck: { text: '', fn: () => { S.messung = { punkte: [], liste: [] }; messZeichnen(); messErgebnisZeichnen(); } },
  kwAnwenden: { text: 'Anwenden', fn: kwAnwenden },
  kwZurueck: { text: '', fn: kwZurueck },
  afVorschau: { text: 'Automatische Flächen: Vorschau', fn: afVorschau },
  afAnwenden: { text: 'Automatische Flächen', fn: afAnwenden },
  afZurueck: { text: '', fn: kwZurueck },
  flVorschau: { text: 'Fläche aus Auswahl: Vorschau', fn: flVorschau },
  flAnwenden: { text: 'Fläche aus Auswahl', fn: flAnwenden },
  kaAus: { text: 'Abweichungskarte aus', fn: kaAus },
  zebraAn: { text: 'Zebra-Streifen', fn: () => analyseSetzen($('#koerperAnalyse').value === 'zebra' ? '' : 'zebra') },
  schraegeAn: { text: 'Formschräge', fn: () => analyseSetzen($('#koerperAnalyse').value === 'schraege' ? '' : 'schraege') },
  anCad: { text: 'An V3D CAD übergeben', fn: () => {
    koerperExport('step');
    window.open('https://v3dcad.volme3dakademie.de', '_blank');
    meldung('STEP gespeichert – in V3D CAD über „Import (STL/STEP/…)“ öffnen; Flächen bleiben echte B-Rep.', 'ok');
  } },
  koerperStep: { text: 'Körper als STEP exportieren', fn: () => koerperExport('step') },
  koerperIges: { text: 'Körper als IGES exportieren', fn: () => koerperExport('iges') },
  anzeigeReiter: { text: 'Anzeigeoptionen', fn: () => rechtsSetzen('anzeige') },
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

// ---------------------------------------------------------------------------
// Menüband, Datei-Menü, rechte Reiter, Konsole
// ---------------------------------------------------------------------------
function bandSetzen(name) {
  $$('#bandReiter [data-band]').forEach((x) => x.classList.toggle('an', x.dataset.band === name));
  $$('.bandseite').forEach((x) => x.classList.toggle('an', x.dataset.bandseite === name));
  localStorage.setItem('v3dscan.band', name);
}
$$('#bandReiter [data-band]').forEach((b) => b.addEventListener('click', () => bandSetzen(b.dataset.band)));
$('#menueKnopf').addEventListener('click', (ev) => { ev.stopPropagation(); $('#menue').hidden = !$('#menue').hidden; });
document.addEventListener('click', (ev) => {
  if (!$('#menue').hidden && !ev.target.closest('#menue') && !ev.target.closest('[data-menue-export]')) $('#menue').hidden = true;
});
$('#menue').addEventListener('click', (ev) => { if (ev.target.closest('button[data-aktion]')) $('#menue').hidden = true; });
$$('[data-menue-export]').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); $('#menue').hidden = false; }));

function rechtsSetzen(name) {
  $$('#rechtsReiter [data-rechts]').forEach((x) => x.classList.toggle('an', x.dataset.rechts === name));
  $$('.rechtsSeite').forEach((x) => x.classList.toggle('an', x.dataset.rechtsseite === name));
}
$$('#rechtsReiter [data-rechts]').forEach((b) => b.addEventListener('click', () => rechtsSetzen(b.dataset.rechts)));
$('#konsoleZu').addEventListener('click', () => {
  $('#konsole').classList.toggle('zu');
  $('#konsoleZu').textContent = $('#konsole').classList.contains('zu') ? '▴' : '▾';
});

// ---------------------------------------------------------------------------
// Werkzeugfenster: holt Abschnitte aus #werkzeugablage ins Ansichtsfenster.
// Kopf: 👁 = Vorschau, ✓ = Übernehmen, ✕ = Zurücksetzen + Schließen.
// ---------------------------------------------------------------------------
const WF = { teile: [], knopf: null };

function wfKnopf(haupt, art) {
  if (!haupt) return null;
  const nachText = (re) => [...haupt.querySelectorAll('button')].find((b) => re.test(b.textContent.trim()));
  if (art === 'vorschau') return haupt.querySelector('[data-vorschau]') || nachText(/^Vorschau/);
  if (art === 'ok') return haupt.querySelector('[data-anwenden]') || haupt.querySelector('button.haupt');
  return haupt.querySelector('[data-zuruecksetzen]') || nachText(/^Zurücksetzen/);
}

function werkzeugOeffnen(liste, knopf = null) {
  werkzeugSchliessen(false);
  const ids = liste.split(/\s+/).filter(Boolean);
  const inhalt = $('#wfInhalt');
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) { inhalt.appendChild(el); WF.teile.push(el); }
  }
  const haupt = [...WF.teile].reverse().find((el) => el.tagName === 'SECTION');
  $('#wfTitel').textContent = haupt ? (haupt.dataset.titel || 'Werkzeug') : 'Werkzeug';
  WF.haupt = haupt;
  $('#wfVorschau').hidden = !wfKnopf(haupt, 'vorschau');
  $('#wfOk').hidden = !wfKnopf(haupt, 'ok');
  $('#werkzeugfenster').hidden = false;
  WF.knopf = knopf;
  $$('#band button').forEach((b) => b.classList.toggle('an', b === knopf));
  inhalt.scrollTop = 0;
  if (haupt && haupt.id === 'w-grundkoerper') gkFeldZeichnen();
  if (haupt && haupt.id === 'w-koerper-abw') kaFuellen();
  if (haupt && ['w-skizze', 'w-extrudieren', 'w-drehen', 'w-kanten'].includes(haupt.id)) featureAuswahlFuellen();
  if (haupt && haupt.id === 'w-skizze') skFelderZeigen();
  if (haupt && haupt.id === 'w-extrudieren') $('#exLaengeReihe').hidden = $('#exModus').value === 'auto';
  if (haupt && haupt.id === 'w-kanten') knZeichnen();
  if (haupt && (haupt.dataset.kw || haupt.id === 'w-auto-flaechen' || haupt.id === 'w-flaeche')) kwFuellen();
  if (haupt && haupt.id === 'w-schale') scZeichnen();
  if (haupt && haupt.id === 'w-referenz') { refAuswahlFuellen(); rfFelder(); }
  if (haupt && haupt.id === 'w-messen') messErgebnisZeichnen();
  if (haupt && ['w-loft', 'w-sweep', 'w-abwickeln'].includes(haupt.id)) { v09Fuellen(); kwFuellen(); }
}

function werkzeugSchliessen(zuruecksetzen = true) {
  if (zuruecksetzen && WF.haupt) {
    const z = wfKnopf(WF.haupt, 'zurueck');
    if (z) z.click();
    if (WF.haupt.id === 'w-grundkoerper') gkVorschauWeg();
  }
  const ablage = $('#werkzeugablage');
  for (const el of WF.teile) ablage.appendChild(el);
  WF.teile = []; WF.haupt = null;
  $('#werkzeugfenster').hidden = true;
  if (WF.knopf) WF.knopf.classList.remove('an');
  WF.knopf = null;
}

$('#wfVorschau').addEventListener('click', () => { const b = wfKnopf(WF.haupt, 'vorschau'); if (b) b.click(); });
$('#wfOk').addEventListener('click', () => { const b = wfKnopf(WF.haupt, 'ok'); if (b) b.click(); });
$('#wfZu').addEventListener('click', () => werkzeugSchliessen(true));
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-wf]');
  if (!b) return;
  if (WF.knopf === b) { werkzeugSchliessen(true); return; }
  werkzeugOeffnen(b.dataset.wf, b);
});

// Werkzeugfenster am Kopf verschieben
(() => {
  const fenster = $('#werkzeugfenster');
  let start = null;
  fenster.querySelector('.wfKopf').addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('button')) return;
    const r = fenster.getBoundingClientRect(), eltern = fenster.parentElement.getBoundingClientRect();
    start = { x: ev.clientX, y: ev.clientY, l: r.left - eltern.left, t: r.top - eltern.top, w: eltern.width - r.width, h: eltern.height - 40 };
    ev.currentTarget.setPointerCapture(ev.pointerId);
  });
  fenster.querySelector('.wfKopf').addEventListener('pointermove', (ev) => {
    if (!start) return;
    fenster.style.left = Math.max(0, Math.min(start.w, start.l + ev.clientX - start.x)) + 'px';
    fenster.style.top = Math.max(0, Math.min(start.h, start.t + ev.clientY - start.y)) + 'px';
  });
  fenster.querySelector('.wfKopf').addEventListener('pointerup', () => { start = null; });
})();

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
$('#netzAnsicht').addEventListener('change', (ev) => {
  S.netzAnsicht = ev.target.value;
  for (const e of S.scans.values()) {
    if (!e.tri) continue;
    const alt = e.obj;
    const neu = objektBauen({ n: e.n, xyz: e.xyz, rgb: e.rgb, nrm: e.nrm, tri: e.tri }, e.meta.farbe);
    szene.remove(alt); alt.material.dispose(); e.geo.dispose();
    Object.assign(e, { obj: neu.obj, geo: neu.geo, farbe: neu.farbe, mark: neu.mark });
    neu.obj.userData.scanId = e.id;
    neu.obj.visible = e.meta.sichtbar && !e.vorschau;
    szene.add(neu.obj);
  }
  alleFarbenSetzen(); alleMarkierungen(); einstellungenMerken();
});
$('#obenAchse').addEventListener('change', (ev) => { S.oben = ev.target.value; blick(achsenRichtung('iso')); alleFarbenSetzen(); einstellungenMerken(); });
$('#durchWahl').addEventListener('change', (ev) => durchSetzen(ev.target.checked));
$('#wahlBewegt').addEventListener('change', () => { S.paare = []; S.paarRest = null; hilfenZeichnen(); regZuruecksetzen(false); });
$('#wahlFest').addEventListener('change', () => {
  S.paare = []; S.paarRest = null; hilfenZeichnen(); regZuruecksetzen(false);
  sicher(() => api('scan/setzen', { id: Number($('#wahlFest').value), fest: true }));
});

function einstellungenMerken() {
  localStorage.setItem('v3dscan.ansicht', JSON.stringify({ punktGroesse: S.punktGroesse, farbModus: S.farbModus, schattierung: S.schattierung, oben: S.oben, netzAnsicht: S.netzAnsicht }));
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
  $('#netzAnsicht').value = S.netzAnsicht;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function start() {
  einstellungenLaden();
  tastenLaden();
  bandSetzen(localStorage.getItem('v3dscan.band') || 'start');
  werkzeugSetzen('orbit');
  groesseAnpassen();
  zeichnen();
  const r = await fetch('/api/zustand');
  const z = await r.json();
  $('#fassung').textContent = 'V3D Scan ' + z.fassung;
  S.formate = z.formate;
  S.formateNetz = z.formate_netz;
  exportFormateSetzen();
  await zustandUebernehmen(z);
  if (z.scans.length) blick(achsenRichtung('iso'));
  else gitterSetzen(new THREE.Sphere(new THREE.Vector3(), 100));
  setInterval(() => fetch('/api/puls').catch(() => status('Verbindung zum Dienst verloren – Programm neu starten.')), 10000);
  fetch('/api/puls');
  steuerung.addEventListener('change', kameraGrenzen);
  window.v3dscan = { S, api, einpassen, werkzeugSetzen, punktAn, auswahlAnwenden, kamera, steuerung, renderer,
    werkzeugOeffnen, werkzeugSchliessen, bandSetzen, formWaehlen, kaefigEckeAn };
  konsole('V3D Scan ' + z.fassung + ' bereit.');
}
start().catch((e) => meldung('Start fehlgeschlagen: ' + e.message, 'fehler'));
