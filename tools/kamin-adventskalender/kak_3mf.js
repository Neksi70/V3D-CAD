// Kamin-Adventskalender — 3MF mit MEHREREN Druckplatten in einer Datei (Bambu Studio / OrcaSlicer).
// Läuft im Browser (globales fflate) und in Node (opt.fflate = require('fflate')).
//
// kak3mfMehrplatten(platten, opt) → Uint8Array (ZIP)
//   platten: [{ name, teile: [{ name, hex: '#rrggbb', gruppe?, vert: Float32Array (x,y,z mm, Z oben), tri: Uint32Array }] }]
//            Teile liegen in Plattenkoordinaten (0…bettX, 0…bettY, z ≥ 0).
//   opt.bett     [X, Y, Z] — Druckbereich des Zieldruckers (Prüfung „ragt heraus“; Plattenabstand, falls kein Profil).
//                Plattenabstand = printable_area aus opt.projectSettings, wenn vorhanden (so rechnet Bambu).
//   opt.app      Application-Kennung, Standard 'BambuStudio-02.08.02.61' (macht die Datei zum Bambu-Projekt).
//   opt.projectSettings  Objekt → Metadata/project_settings.config (JSON). PFLICHT für mehrere Platten:
//                · ohne Application = „fremde“ 3MF → Bambu-CLI: nur Platte 1, Rest „unprintable area“; Orca-GUI: nur Geometrie
//                · Application ohne project_settings → Bambu-CLI 02.08 stürzt ab (SIGSEGV, liest printer_settings_id),
//                  Orca/Bambu-GUI fallen auf „nur Geometrie“ zurück (keine Platten).
//                In der App: _bbsProjekt(…).settings (vollständig, inkl. filament_extruder_variant/self_index für die GUI).
//                Dem CLI allein reichen 5 Schlüssel (printer_settings_id, print_settings_id, filament_settings_id,
//                nozzle_diameter, printable_height) — für die GUI nicht verwenden.
//   opt.titel    Titel-Metadaten.
//   opt.farben   [HEX…] — feste Filament-Reihenfolge (Extruder 1…n), passend zu filament_colour in projectSettings.
//
// Plattenraster wie Bambu/Orca (PartPlate.cpp: compute_shape_position / compute_colum_count / LOGICAL_PART_PLATE_GAP=1/5):
//   Spalten = round(sqrt(n)), +1 falls sqrt(n) > round  (= ceil(sqrt(n)));  Platte i: Spalte i % cols, Zeile floor(i / cols)
//   Ursprung = (Spalte · X · 1,2 ; −Zeile · Y · 1,2). Welche Platte ein Objekt hat, entscheidet Bambu nach der LAGE
//   (load_from_3mf_structure: „we will rebuild later“); die <plate>-Blöcke liefern Anzahl + Namen.
(function (root) {
  const GAP = 1 / 5;
  function kakPlattenSpalten(n) {
    const v = Math.sqrt(n), r = Math.round(v);
    return v > r ? r + 1 : r;
  }
  // Plattengröße fürs Raster = printable_area des Druckerprofils (Bambu: m_plate_width/m_plate_depth),
  // NICHT ein „sicherer“ Teilbereich (H2C: 330 × 320, auch wenn nur 300 breit für beide Düsen erreichbar ist)
  function kakRasterBett(opt) {
    const pa = opt.projectSettings && opt.projectSettings.printable_area;
    if (Array.isArray(pa) && pa.length >= 3) {
      const pts = pa.map(s => String(s).split('x').map(Number));
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const w = Math.max(...xs) - Math.min(...xs), d = Math.max(...ys) - Math.min(...ys);
      if (w > 0 && d > 0) return [w, d];
    }
    return opt.bett || [256, 256, 256];
  }
  function kakPlattenUrsprung(i, n, bett) {
    const cols = kakPlattenSpalten(n);
    return [(i % cols) * bett[0] * (1 + GAP), -Math.floor(i / cols) * bett[1] * (1 + GAP)];
  }

  function kak3mfMehrplatten(platten, opt = {}) {
    const ff = opt.fflate || (typeof fflate !== 'undefined' ? fflate : null);
    if (!ff) throw new Error('fflate fehlt (Browser: global, Node: opt.fflate)');
    if (!Array.isArray(platten) || !platten.length) throw new Error('keine Platten');
    if (platten.length > 36) throw new Error('Mehr als 36 Platten — Bambu-Grenze (MAX_PLATE_COUNT)');
    const warnungen0 = [];
    const bett = opt.bett || [256, 256, 256];                     // für die Prüfung „ragt aus dem Bett“
    const raster = kakRasterBett(opt);                            // für den Plattenabstand
    if (opt.bett && (Math.abs(raster[0] - bett[0]) > 0.01 || Math.abs(raster[1] - bett[1]) > 0.01))
      warnungen0.push(`Plattenraster nach Druckerprofil ${raster[0]} × ${raster[1]} mm (opt.bett ${bett[0]} × ${bett[1]})`);
    const app = opt.app === undefined ? 'BambuStudio-02.08.02.61' : opt.app;
    const xEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const zahl = v => { const s = v.toFixed(4); return s.indexOf('.') < 0 ? s : s.replace(/0+$/, '').replace(/\.$/, '').replace(/^-0$/, '0'); };

    const farben = new Map();                                     // HEX → Extruder (1-basiert), Reihenfolge des Auftretens
    const extruderVon = hex => {
      const h = String(hex || '#cccccc').replace('#', '').toUpperCase();
      if (!farben.has(h)) {
        if (farben.size >= 16) throw new Error('Mehr als 16 Farben/Filamente — Slicer-Grenze');
        farben.set(h, farben.size + 1);
      }
      return farben.get(h);
    };
    for (const h of opt.farben || []) extruderVon(h);             // feste Reihenfolge = filament_colour der Projekt-Einstellungen

    const n = platten.length;
    let nextId = 1;
    const objXml = [], itemXml = [], cfgObj = [], cfgPlate = [];
    const warnungen = warnungen0;

    platten.forEach((pl, pi) => {
      // Teile zu Objekten bündeln: gleiche gruppe = ein Objekt, ohne gruppe = eigenes Objekt
      const objekte = [], proGruppe = new Map();
      (pl.teile || []).forEach(t => {
        if (!t || !t.vert || !t.tri || !t.tri.length) return;
        if (t.gruppe != null && t.gruppe !== '') {
          const key = String(t.gruppe);
          if (!proGruppe.has(key)) { const o = { name: key, teile: [] }; proGruppe.set(key, o); objekte.push(o); }
          proGruppe.get(key).teile.push(t);
        } else objekte.push({ name: t.name || ('Teil ' + (objekte.length + 1)), teile: [t] });
      });
      const [ox, oy] = kakPlattenUrsprung(pi, n, raster);
      const inst = [];
      objekte.forEach(o => {
        // Objekt-Mitte (XY) als Bezugspunkt: Netze relativ dazu, Item-Transform setzt es an die Stelle auf der Platte
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z0 = Infinity;
        o.teile.forEach(t => { const v = t.vert; for (let k = 0; k < v.length; k += 3) {
          if (v[k] < x0) x0 = v[k]; if (v[k] > x1) x1 = v[k]; if (v[k + 1] < y0) y0 = v[k + 1]; if (v[k + 1] > y1) y1 = v[k + 1]; if (v[k + 2] < z0) z0 = v[k + 2]; } });
        if (x0 < -0.01 || y0 < -0.01 || x1 > bett[0] + 0.01 || y1 > bett[1] + 0.01 || z0 < -0.01)
          warnungen.push(`Platte ${pi + 1} „${o.name}“ ragt aus dem Bett (${zahl(x0)}…${zahl(x1)} × ${zahl(y0)}…${zahl(y1)}, z ${zahl(z0)})`);
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const comp = [], parts = [];
        let ersterExt = 0;
        o.teile.forEach(t => {
          const id = nextId++, v = t.vert, tri = t.tri;
          const vs = new Array(v.length / 3), ts = new Array(tri.length / 3);
          for (let k = 0, j = 0; k < v.length; k += 3, j++) vs[j] = `<vertex x="${zahl(v[k] - cx)}" y="${zahl(v[k + 1] - cy)}" z="${zahl(v[k + 2])}"/>`;
          for (let k = 0, j = 0; k < tri.length; k += 3, j++) ts[j] = `<triangle v1="${tri[k]}" v2="${tri[k + 1]}" v3="${tri[k + 2]}"/>`;
          objXml.push(`  <object id="${id}" type="model"><mesh><vertices>${vs.join('')}</vertices><triangles>${ts.join('')}</triangles></mesh></object>`);
          comp.push(`<component objectid="${id}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`);
          const ext = extruderVon(t.hex); if (!ersterExt) ersterExt = ext;
          parts.push(`  <part id="${id}" subtype="normal_part"><metadata key="name" value="${xEsc(t.name || ('Teil ' + id))}"/><metadata key="extruder" value="${ext}"/></part>`);
        });
        const asm = nextId++;
        objXml.push(`  <object id="${asm}" type="model"><components>${comp.join('')}</components></object>`);
        itemXml.push(`  <item objectid="${asm}" transform="1 0 0 0 1 0 0 0 1 ${zahl(ox + cx)} ${zahl(oy + cy)} 0" printable="1"/>`);
        cfgObj.push(` <object id="${asm}">\n  <metadata key="name" value="${xEsc(o.name)}"/>\n  <metadata key="extruder" value="${ersterExt}"/>\n${parts.join('\n')}\n </object>`);
        inst.push(`  <model_instance>\n   <metadata key="object_id" value="${asm}"/>\n   <metadata key="instance_id" value="0"/>\n   <metadata key="identify_id" value="${asm}"/>\n  </model_instance>`);
      });
      cfgPlate.push(` <plate>\n  <metadata key="plater_id" value="${pi + 1}"/>\n  <metadata key="plater_name" value="${xEsc(pl.name || '')}"/>\n  <metadata key="locked" value="false"/>\n${inst.join('\n')}\n </plate>`);
    });
    if (!itemXml.length) throw new Error('keine Teile mit Geometrie');

    const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
${app ? ` <metadata name="Application">${xEsc(app)}</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n` : ''} <metadata name="Title">${xEsc(opt.titel || 'Kamin-Adventskalender')}</metadata>
 <metadata name="Designer">V3D CAD</metadata>
 <resources>
${objXml.join('\n')}
 </resources>
 <build>
${itemXml.join('\n')}
 </build>
</model>`;
    const cfg = `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${cfgObj.join('\n')}\n${cfgPlate.join('\n')}\n</config>\n`;
    const ct = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/xml"/><Default Extension="xml" ContentType="application/xml"/></Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
    const u8 = s => ff.strToU8(s);
    const dateien = {
      '[Content_Types].xml': u8(ct),
      '_rels/.rels': u8(rels),
      '3D/3dmodel.model': u8(model),
      'Metadata/model_settings.config': u8(cfg),
    };
    if (opt.projectSettings) dateien['Metadata/project_settings.config'] = u8(JSON.stringify(opt.projectSettings, null, 4));
    const zip = ff.zipSync(dateien, { level: 6 });
    // Zusatzinfos ohne die Rückgabe (Uint8Array) zu ändern
    zip.legende = [...farben.entries()].map(([h, e]) => e + '=#' + h);
    zip.warnungen = warnungen;
    return zip;
  }

  const api = { kak3mfMehrplatten, kakPlattenUrsprung, kakPlattenSpalten, kakRasterBett };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
