#!/usr/bin/env node
/**
 * Volme3D Build — erzeugt aus der Arbeitskopie volme3d.html eine
 * gehaertete Auslieferungs-Version volme3d.dist.html.
 *
 * Was passiert:
 *  - Jeder inline <script>-Block wird mit terser minified:
 *    Kommentare raus, Whitespace gestrippt, lokale Variablen umbenannt,
 *    Dead Code entfernt.
 *  - Top-Level-Funktionsnamen bleiben ERHALTEN (mangle.toplevel=false),
 *    weil 622 inline onclick="..."-Handler sie global aufrufen. Wuerden
 *    wir sie umbenennen, waeren alle Buttons kaputt.
 *  - <script src="...">-Einbindungen bleiben unangetastet.
 *
 * Hinweis: Das ist KEINE echte Verschluesselung. Browser-Code laeuft
 * im Klartext im Browser. Es ist eine Huerde gegen "Quelltext anzeigen"
 * und 1:1-Kopieren — nicht gegen entschlossenes Reverse Engineering.
 *
 * Aufruf:  node build.js   (oder: npm run build)
 */
const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const SRC = path.join(__dirname, 'volme3d.html');
const OUT = path.join(__dirname, 'volme3d.dist.html');

// Matcht <script ...>INHALT</script>. Vorab verifiziert: in volme3d.html
// kommt "</script" nur als echtes Tag-Ende vor, nie in Strings -> sicher.
// schicht-kern.js entsteht aus dem Rechenkern des V3D Slicers — vor dem
// Einbetten frisch erzeugen, damit CAD und Slicer nicht auseinanderlaufen
if (fs.existsSync(path.join(__dirname, 'orca-wasm/web/adaptive-layers.js'))) {
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'tools/bau_schicht_kern.mjs')], { stdio: 'inherit' });
}
// druckcheck-kern.js genauso aus dem V3D Druckcheck (orca-wasm/web/print-check.js)
if (fs.existsSync(path.join(__dirname, 'orca-wasm/web/print-check.js'))) {
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'tools/bau_druck_kern.mjs')], { stdio: 'inherit' });
}
// Die ganze Druckcheck-Seite (Bibliothek → 🩺 Druck prüfen lädt sie als /druckcheck.html).
// index.html ist ein Bau-Ergebnis und nicht im Git → hier frisch bauen (auch auf netcup).
if (fs.existsSync(path.join(__dirname, 'v3ddruckcheck/bauen.py'))) {
  try { require('child_process').execFileSync('python3', [path.join(__dirname, 'v3ddruckcheck/bauen.py')], { stdio: 'inherit' }); }
  catch (e) { console.warn('WARNUNG: v3ddruckcheck/bauen.py fehlgeschlagen – /druckcheck.html bleibt alt:', e.message); }
}

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;

async function build() {
  const html = fs.readFileSync(SRC, 'utf8');

  let blocks = 0, minified = 0, srcSkipped = 0, errors = 0;
  const parts = [];
  let lastIndex = 0;
  let m;

  // Matches sammeln (Regex + async terser vertragen sich nicht in replace())
  const matches = [];
  while ((m = SCRIPT_RE.exec(html)) !== null) {
    matches.push({ full: m[0], attrs: m[1], code: m[2], index: m.index });
  }

  for (let match of matches) {
    parts.push(html.slice(lastIndex, match.index));
    lastIndex = match.index + match.full.length;

    blocks++;
    let hasSrc = /\bsrc\s*=/.test(match.attrs);

    // Ausgewaehlte lokale Dateien werden EINGEBETTET statt verlinkt: die
    // Auslieferung soll eine einzige Datei bleiben. Nur was hier steht —
    // lib/three.min.js & Co. bleiben absichtlich draussen, die sind gross
    // und aendern sich nie.
    const EINBETTEN = ['cam-kern.js', 'schicht-kern.js', 'druckcheck-kern.js', 'weihnachts-kern.js'];
    if (hasSrc) {
      const m2 = /\bsrc\s*=\s*["']([^"']+)["']/.exec(match.attrs);
      const datei = m2 && m2[1];
      if (datei && EINBETTEN.includes(datei)) {
        const pfad = path.join(path.dirname(SRC), datei);
        if (!fs.existsSync(pfad)) {
          errors++;
          console.error(`  \u2717 ${datei} fehlt \u2014 kann nicht eingebettet werden`);
          parts.push(match.full);
          continue;
        }
        match = { ...match, attrs: '', code: fs.readFileSync(pfad, 'utf8') };
        hasSrc = false;
        console.log(`  \u2192 ${datei} eingebettet (${(match.code.length / 1024).toFixed(0)} KB)`);
      }
    }
    const isModule = /\btype\s*=\s*["']module["']/.test(match.attrs);

    if (hasSrc || match.code.trim() === '') {
      srcSkipped++;
      parts.push(match.full);
      continue;
    }

    // type=module: terser braucht module:true um top-level import zu parsen.
    // Dieser Block ist winzig; lokale Namen manglen ist hier unkritisch.
    // Klassische Bloecke: toplevel:false, sonst brechen onclick-Handler.
    const opts = isModule
      ? { module: true, compress: true, mangle: true, format: { comments: false } }
      : { compress: true, mangle: { toplevel: false }, format: { comments: false } };

    const res = await minify(match.code, opts);
    if (res.error || typeof res.code !== 'string') {
      errors++;
      console.error(`  ✗ Block @${match.index} konnte nicht minified werden:`, res.error);
      parts.push(match.full); // im Zweifel Original behalten -> App bleibt lauffaehig
      continue;
    }

    minified++;
    parts.push(`<script${match.attrs}>${res.code}</script>`);
  }
  parts.push(html.slice(lastIndex));

  if (errors > 0) {
    console.error(`\nABBRUCH: ${errors} Block/Bloecke fehlerhaft — dist NICHT geschrieben.`);
    process.exit(1);
  }

  const out = parts.join('');
  fs.writeFileSync(OUT, out, 'utf8');

  const kb = n => (n / 1024).toFixed(0).padStart(5) + ' KB';
  console.log(`volme3d.html      ${kb(html.length)}`);
  console.log(`volme3d.dist.html ${kb(out.length)}   (-${(100 * (1 - out.length / html.length)).toFixed(1)}%)`);
  console.log(`Bloecke: ${blocks} gesamt, ${minified} minified, ${srcSkipped} uebersprungen (src/leer)`);
  console.log(`\nFertig -> ${OUT}`);
}

build().catch(e => { console.error(e); process.exit(1); });
