// H2C 0500-4047-Fix — MINIMAL & GEZIELT.
//
// Root-Cause (per Header-Diff gegen echten Studio-Poolvorfilter-Slice bestätigt,
// 2026-07-18): Die H2C-Firmware validiert die HOTEND-/EXTRUDER-Topologie im
// G-Code-Header (`; key = value`-Block in Metadata/plate_1.gcode), NICHT in
// project_settings. Unser nativer OrcaSlicer-Pfad überspringt Studios
// update_values_to_printer_extruders-Kontraktion → er schreibt die per-VARIANTEN-
// Arrays (4 Werte = 2 Extruder × 2 Varianten) roh in den Header. Die Firmware zählt
// daraus 4 Hotends statt 2 → "Hotend-Modell/-Menge stimmt nicht" [0500-4047].
// Zusätzlich fehlen/leer: extruder_nozzle_stats, nozzle_volume_type (Hotend-Typ),
// extruder_ams_count (falsche Seite), machine_switch_extruder_time, filament_nozzle_map.
//
// FIX: genau diese Keys im G-Code-Header auf Studios per-Extruder-Werte setzen
// (kontrahiert 4→2, fehlende ergänzen), md5 neu. project_settings bleibt unberührt —
// die Firmware liest den Header. Kein 162-Key-Superset, keine Key-Löschungen, kein
// filament_map-Umschreiben mehr (das verwirrte früher und "half nicht").
//
// Werte gelten für DIESEN Drucker (H2C 0.4, Standard-Hotends bds, AMS rechts) — aus
// dem echten Studio-Slice (Poolvorfilter01) desselben Druckers. Nutzt system-zip/unzip.
const { execFileSync } = require('child_process');
const { renumberGcode, renumberSliceInfo } = require('./renumber-filaments');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const GCODE = 'Metadata/plate_1.gcode';
const GMD5 = 'Metadata/plate_1.gcode.md5';
const SLICEINFO = 'Metadata/slice_info.config';

// Die H2C-Firmware validiert Generator + Slicer-Version des 3MF. Unser Fork meldet
// "OrcaSlicer 2.5.0-dev" / X-BBL-Client-Version 02.06.00.51 → die Firmware lehnt es als
// "3MF ungültig, aktualisieren Sie Studio" ab = [0500-4046]. Studios akzeptierter Slice:
// G-Code-Zeile 2 "; BambuStudio 02.07.01.62" + X-BBL-Client-Version 02.07.01.62. Wir
// maskieren beides auf Studios Werte.
const BS_VERSION = '02.07.01.62';

// key -> exakter Wert wie in Studios H2C-0.4-G-Code-Header (per Extruder, 2 Werte).
const HEADER = {
  hotend_cooling_rate: '1.6,3.4',            // war 1.6,1.6,3.4,3.4 (4 = per Variante)
  hotend_heating_rate: '3.5,13.3',           // war 3.5,3.5,13.3,13.3
  nozzle_volume_type: 'Standard,Standard',   // war "Standard" (1 Wert)
  extruder_nozzle_stats: 'Standard#1;Standard#4', // fehlte
  // Studios echte H2C-Datei (Byte-Referenz f1levelholderV2, BambuStudio 02.07.01.62)
  // nutzt genau diese AMS-Topologie — NICHT den nativen Wert "1#0;1#0|4#0".
  extruder_ams_count: '1#0|4#0;1#0|4#1',
  machine_switch_extruder_time: '5',         // fehlte
  filament_nozzle_map: '0,1,0,0,0',          // Studio: Filament 2 (Slot 2) auf Düse 1 (rechts)
  // extruder_colour MUSS pro Extruder (2 Werte) stehen. Unser Slice schreibt die
  // 5 FILAMENT-Farben rein → die Firmware zählt 5 "Extruder" statt 2 → "Hotend-Menge
  // stimmt nicht" [0500-4047]. DAS ist der eigentliche Mengen-Trigger.
  extruder_colour: '#018001;#018001',
  filament_map_mode: 'Auto For Flush',       // war Manual (Studio: Auto For Flush)
  // Studio legt das AMS-Filament auf SLOT 2 (rechter/AMS-Extruder-Slot): filament_map
  // 1,2,1,1,1 + filament_nozzle_map 0,1,0,0,0. Unser Slice legt es auf Slot 1 (2,1,1,1,1)
  // → letzter verbleibender Unterschied zu Studio → 4047-Trigger. Auf Studio angleichen.
  filament_map: '1,2,1,1,1',
  // WICHTIG: extruder_ams_count NICHT überschreiben! Der native Slicer berechnet die
  // echte AMS-Topologie dieses Druckers korrekt (extern links, 1 AMS rechts →
  // "1#0;1#0|4#0"). Poolvorfilters Wert "1#0|4#0;1#0|4#1" (AMS an beiden + Unit 1)
  // passt NICHT zu dieser Hardware → war mit-Ursache von 0500-4047. extruder_nozzle_stats
  // Standard#1;Standard#4 = links 1 externes Filament, rechts 4 AMS-Farben → passt.
};

// Keys, die Studios H2C-Header NICHT hat — raus (verwirren die Hotend-/Mengen-Zählung).
const REMOVE = ['single_extruder_multi_material_priming', 'nozzle_hrc',
                'wiping_volumes_extruders', 'extruder_clearance_radius'];

// project_settings.config: DAS liest die Firmware für "Hotend-Menge/-Modell" [0500-4047].
// Unser nativer Slicer erzeugt hier print_extruder_id mit 5 statt 4 Werten (Varianten-
// Expansions-Bug) + leeres nozzle_volume_type + fehlendes extruder_nozzle_stats → die
// Firmware zählt die falsche Hotend-Menge/-Modell. Auf Studios exakte Werte setzen.
const PS_SET = {
  print_extruder_id: ['1', '1', '2', '2'],
  print_extruder_variant: ['Direct Drive Standard', 'Direct Drive High Flow', 'Direct Drive Standard', 'Direct Drive High Flow'],
  nozzle_volume_type: ['Standard', 'Standard'],
  extruder_nozzle_stats: ['Standard#1', 'Standard#4'],
  extruder_ams_count: ['1#0|4#0', '1#0|4#1'], // Studios echter H2C-Wert (Byte-Referenz)
  extruder_colour: ['#018001', '#018001'],
  filament_nozzle_map: ['1'],                  // Studio: EIN Wert
  filament_extruder_compatibility: ['0', '0', '0', '0', '0'],
  machine_switch_extruder_time: '5',
  extruder_clearance_dist_to_rod: '50',
  extruder_clearance_max_radius: '96',
};
const PS_REMOVE = ['single_extruder_multi_material_priming', 'nozzle_hrc',
                   'wiping_volumes_extruders', 'extruder_clearance_radius'];
const PROJSET = 'Metadata/project_settings.config';

// Gibt Pfad zu einer KOPIE mit korrigiertem Header zurück (oder wirft).
// opts.thumbnail: PNG-Buffer der App-Plattenvorschau → wird als plate_1.png &
// Co. eingepackt (Job-Miniatur auf dem Drucker-Display statt 1×1-Platzhalter).
function injectMissingKeys(gcode3mfPath, opts = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'h2c-inject-'));
  const copy = path.join(work, path.basename(gcode3mfPath));
  fs.copyFileSync(gcode3mfPath, copy);

  execFileSync('unzip', ['-o', copy, GCODE, GMD5, '-d', work], { stdio: 'ignore' });
  const gcodePath = path.join(work, GCODE);
  let g = fs.readFileSync(gcodePath, 'utf8');

  // H2C-Vortek-Mehrfarbe → auf Bambus 1-basiertes Filament-Layout schieben (Filament 0 =
  // ungenutzter RECHTS-Platzhalter, Farben ab 1). Byte-Diff gegen Bambu: alles identisch
  // AUSSER +1 auf jedem Filament-Index; unser Grün=Filament 0 (Initial) → Firmware-Sonder-
  // behandlung beim letzten Load → stg=4-Layer-49-Hänger. Post-Process auf dem FERTIGEN
  // G-Code, App-Farbkette bleibt 0-basiert/korrekt. Gilt nur H2C + >1 Filament.
  const _fcM = g.match(/^; filament_map = (.+)$/m);
  const doRenumber = /Bambu Lab H2C/.test(g) && _fcM && _fcM[1].split(',').length > 1;

  // Anker: die filament_map-Zeile existiert im Header (Studio-Trick setzt sie).
  const anchor = /^; filament_map = .*$/m;
  let gfix = 0;
  // Extra-Keys entfernen (ganze Zeile)
  for (const key of REMOVE) {
    const re = new RegExp('^; ' + key + ' = .*$\\n', 'm');
    if (re.test(g)) { g = g.replace(re, ''); gfix++; }
  }
  // HEADER-Injektion NUR wenn NICHT renumbered: bei H2C-Mehrfarbe (doRenumber) muss der
  // native filament_map="2,2" (alles rechts) erhalten bleiben, damit der Renumber ihn
  // korrekt auf "2,2,2" schiebt. HEADER['filament_map']='1,2,1,1,1' (mit 1=LINKS!) und
  // extruder_ams_count='…4#1' würden sonst 0500-4047 auslösen — sie waren bisher nur durch
  // den Zip-Bug maskiert (nie angewandt); mit dem Zip-Fix würden sie plötzlich greifen.
  if (!doRenumber) for (const [key, val] of Object.entries(HEADER)) {
    const re = new RegExp('^; ' + key + ' = .*$', 'm');
    const line = '; ' + key + ' = ' + val;
    if (re.test(g)) { g = g.replace(re, line); gfix++; }
    else if (anchor.test(g)) { g = g.replace(anchor, m => m + '\n' + line); gfix++; }
  }
  // Generator-Zeile maskieren: "; generated by OrcaSlicer 2.5.0-dev on …" (oder was
  // auch immer) → Studios exaktes "; BambuStudio 02.07.01.62". Die Firmware prüft den
  // Generator/die Version → sonst [0500-4046] "3MF ungültig, Studio aktualisieren".
  const genRe = /^; (?:generated by )?(?:OrcaSlicer|BambuStudio)\b.*$/m;
  if (genRe.test(g)) { g = g.replace(genRe, '; BambuStudio ' + BS_VERSION); gfix++; }
  if (doRenumber) { const rn = renumberGcode(g); if (rn.changed) { g = rn.gcode; gfix++; } }
  // H2C-Mehrfarbe (doRenumber): Die HEADER-Injektion oben wurde übersprungen, damit der
  // Renumber die per-Filament-Arrays (filament_map) unangetastet vorfindet. Die
  // PER-EXTRUDER-/Hardware-Deskriptoren müssen aber TROTZDEM gesetzt werden — sonst zählt
  // die H2C-Firmware z.B. aus extruder_colour (unser Slice schreibt 5 FILAMENT-Farben rein!)
  // fünf Hotends statt zwei → Datei-Validierung schlägt fehl mit 0500-4046/4047. Byte-Diff
  // 2026-07-27 gegen ein akzeptiertes Vor-Migrations-File bestätigt: genau diese Keys fehlten
  // bzw. hatten 5 statt 2 Werte. Diese Keys sind renumber-invariant (2 Werte bzw. Skalar, KEIN
  // 5-Wert-per-Filament-Array), daher gefahrlos NACH dem Renumber setzbar. filament_map und
  // filament_nozzle_map bleiben ausgespart (die gehören dem Renumber bzw. dem Druck-Inhalt).
  if (doRenumber) {
    const SKIP = new Set(['filament_map', 'filament_nozzle_map']);
    for (const [key, val] of Object.entries(HEADER)) {
      if (SKIP.has(key)) continue;
      const re = new RegExp('^; ' + key + ' = .*$', 'm');
      const line = '; ' + key + ' = ' + val;
      if (re.test(g)) { g = g.replace(re, line); gfix++; }
      else if (anchor.test(g)) { g = g.replace(anchor, m => m + '\n' + line); gfix++; }
    }
  }
  fs.writeFileSync(gcodePath, g);
  // md5 wie Bambu: Großbuchstaben-Hex
  fs.writeFileSync(path.join(work, GMD5), crypto.createHash('md5').update(g).digest('hex').toUpperCase());

  // slice_info.config: X-BBL-Client-Version auf Studios Wert; OrcaSlicer-Version-Zeile
  // raus (Studio hat sie nicht). Auch das liest die Firmware zur Versionsprüfung.
  try {
    execFileSync('unzip', ['-o', copy, SLICEINFO, '-d', work], { stdio: 'ignore' });
    const siPath = path.join(work, SLICEINFO);
    let si = fs.readFileSync(siPath, 'utf8');
    si = si.replace(/(key="X-BBL-Client-Version" value=")[^"]*(")/,
                    '$1' + BS_VERSION + '$2');
    si = si.replace(/^\s*<header_item key="OrcaSlicer-Version"[^>]*\/>\s*\n?/m, '');
    // H2C-Mehrfarbe: Platzhalter-Filament + Slots +1, damit buildAmsFieldsFromFile
    // ams_mapping=[-1,0,1] baut (passend zum 1-basierten G-Code).
    if (doRenumber) si = renumberSliceInfo(si);
    // KEIN Slot-2-Relabel mehr! Der native Slice ist slot-1-konsistent (benutztes AMS-
    // Filament an Slot 1: filament_maps "2 1 1 1 1" = Slot 1 → rechte Düse, filament id="1",
    // layer_filament_list="0", G-Code-Header filament_colour/ids grün an Index 0). Der
    // Slot-2-Trick (id 1→2) relabelte nur slice_info, NICHT den G-Code-Header → Kommando-
    // ams_mapping=[-1,0,..] (Slot 2) widersprach dem Header (Slot 1) → Drucker liest beim
    // Load "Filament an Slot 1", findet ams_mapping[0]=-1 → 0x7008012. buildAmsFieldsFromFile
    // baut aus dem nativen slice_info jetzt korrekt ams_mapping=[0,-1,..] passend zum Header.
    // (4047 löst das KOMMANDO, nicht die Datei; Leveling nutzt Header filament_map=2 = rechts.)
    fs.writeFileSync(siPath, si);
    execFileSync('zip', ['-q', copy, SLICEINFO], { cwd: work, stdio: 'ignore' });
    gfix++;
  } catch (e) { /* slice_info optional */ }

  // model_settings.config: bleibt slot-1-konsistent (nativer Wert "2 1 1 1 1"/Manual, wie
  // slice_info + G-Code-Header). KEIN Slot-2-Relabel. Ergänzt werden nur fehlende Datei-
  // Referenzen (thumbnail/pick/pattern_bbox_file → plate_1.json) + filament_volume_maps,
  // die der Drucker beim Load erwartet.
  try {
    const MODELSET = 'Metadata/model_settings.config';
    execFileSync('unzip', ['-o', copy, MODELSET, '-d', work], { stdio: 'ignore' });
    const msPath = path.join(work, MODELSET);
    let ms = fs.readFileSync(msPath, 'utf8');
    // H2C-Mehrfarbe: filament_maps hier ebenfalls um den Platzhalter vorne erweitern
    // (konsistent mit slice_info + G-Code-Header).
    if (doRenumber)
      ms = ms.replace(/(<metadata key="filament_maps" value=")([^"]*)("\s*\/>)/,
        (m, a, v, b) => { const p = v.trim().split(/\s+/); return a + [p[0], ...p].join(' ') + b; });
    if (!/filament_volume_maps/.test(ms))
      ms = ms.replace(/(<metadata key="filament_maps" value="([^"]*)"[^>]*\/>)/,
        (m, tag, maps) => tag + '\n    <metadata key="filament_volume_maps" value="'
          + maps.trim().split(/\s+/).map(() => '0').join(' ') + '"/>');
    // Datei-Referenzen ergänzen (wie Studio) — der Drucker sucht plate_1.json u.a. hierüber.
    if (!/pattern_bbox_file/.test(ms))
      ms = ms.replace(/(<metadata key="gcode_file"[^>]*\/>)/,
        '$1\n    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>' +
        '\n    <metadata key="thumbnail_no_light_file" value="Metadata/plate_no_light_1.png"/>' +
        '\n    <metadata key="top_file" value="Metadata/top_1.png"/>' +
        '\n    <metadata key="pick_file" value="Metadata/pick_1.png"/>' +
        '\n    <metadata key="pattern_bbox_file" value="Metadata/plate_1.json"/>');
    fs.writeFileSync(msPath, ms);
    execFileSync('zip', ['-q', copy, MODELSET], { cwd: work, stdio: 'ignore' });
    gfix++;
  } catch (e) { /* model_settings optional */ }

  // filament_sequence.json: bleibt nativ (sequence=[1], Slot 1) — konsistent zu
  // slice_info/model_settings/Header. KEIN Slot-2-Relabel mehr.

  // Referenz-Dateien ergänzen (Studio hat sie; der Drucker erwartet sie beim Load
  // für die AMS-Tabelle). Vorschau-PNGs: echtes Bild von der App, wenn geliefert
  // (Display-Miniatur!), sonst 1×1-Platzhalter. pick_1.png bleibt Platzhalter —
  // das ist eine Objekt-ID-Karte fürs Objekt-Überspringen, kein Foto.
  try {
    const px = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64');
    const thumb = Buffer.isBuffer(opts.thumbnail) && opts.thumbnail.length ? opts.thumbnail : null;
    const md = path.join(work, 'Metadata');
    fs.mkdirSync(md, { recursive: true });
    for (const [f, data] of [
      ['plate_1.png', thumb || px], ['plate_no_light_1.png', thumb || px],
      ['top_1.png', thumb || px], ['pick_1.png', px],
    ]) fs.writeFileSync(path.join(md, f), data);
    fs.writeFileSync(path.join(md, 'cut_information.xml'),
      '<?xml version="1.0" encoding="UTF-8"?>\n<objects/>\n');
    execFileSync('zip', ['-q', copy,
      'Metadata/plate_1.png', 'Metadata/plate_no_light_1.png', 'Metadata/top_1.png',
      'Metadata/pick_1.png', 'Metadata/cut_information.xml'], { cwd: work, stdio: 'ignore' });
  } catch (e) { /* optional */ }

  // project_settings.config: Hotend-/Extruder-Menge+Modell auf Studios Werte (JSON).
  // HINWEIS: Experiment vom 2026-07-18 zeigte, dass ENTFERNEN von project_settings den
  // 0500-4047 NICHT behebt → die Firmware liest die Hotend-Prüfung NICHT aus PS. Der
  // Patch bleibt trotzdem (hält das 3MF Studio-konform), ist aber nicht die 4047-Quelle.
  let psfix = 0;
  try {
    execFileSync('unzip', ['-o', copy, PROJSET, '-d', work], { stdio: 'ignore' });
    const psPath = path.join(work, PROJSET);
    const ps = JSON.parse(fs.readFileSync(psPath, 'utf8'));
    // Laengen-Korrektur fuer Mehrfarbdruck: per-Filament-Keys an die echte
    // Filament-Anzahl der Datei anpassen (PS_SET-Vorlage stammt vom 5-Slot-Einfarbfall)
    const nFil = Array.isArray(ps.filament_colour) && ps.filament_colour.length
      ? ps.filament_colour.length : 5;
    PS_SET.filament_extruder_compatibility = new Array(nFil).fill('0');
    for (const [k, v] of Object.entries(PS_SET)) {
      if (JSON.stringify(ps[k]) !== JSON.stringify(v)) { ps[k] = v; psfix++; }
    }
    for (const k of PS_REMOVE) if (k in ps) { delete ps[k]; psfix++; }
    fs.writeFileSync(psPath, JSON.stringify(ps));
    execFileSync('zip', ['-q', copy, PROJSET], { cwd: work, stdio: 'ignore' });
  } catch (e) { /* project_settings optional */ }

  // plate_1.json ERGÄNZEN — der Drucker liest sie beim Filament-Load, um die AMS-
  // Zuordnungstabelle zu bauen (filament_colors/filament_ids/first_extruder/bed_type).
  // Unser natives 3MF hat sie NICHT → "AMS-Zuordnungstabelle konnte nicht abgerufen
  // werden" [0x7008012], obwohl der project_file-Befehl byte-identisch mit Studio ist.
  let plate = 0;
  try {
    // NUR SLICEINFO re-extrahieren (der renumberte/injizierte Wert wurde bei Z.155
    // zurückgezippt). GCODE NICHT re-extrahieren — sonst überschriebe das -o die bei
    // Z.130 modifizierte work-dir-plate_1.gcode wieder mit dem Original (der alte
    // Zip-Bug: Header- + Renumber-Änderungen verpufften). Die work-dir-Datei liegt
    // noch da und wird bei Z.286 zurückgezippt.
    execFileSync('unzip', ['-o', copy, SLICEINFO, '-d', work], { stdio: 'ignore' });
    const si = fs.readFileSync(path.join(work, SLICEINFO), 'utf8');
    const gc = fs.readFileSync(path.join(work, GCODE), 'utf8');
    // Benutzte Filamente: Farbe UND echte Slot-ID aus slice_info (Mehrfarbdruck:
    // filament_ids müssen die Datei-Slots sein, nicht stur 1..n durchnummeriert)
    const usedFil = [...si.matchAll(/<filament\b[^>]*used_for_object="true"[^>]*>/g)].map(m => m[0]);
    const colors = usedFil.map(s => (s.match(/\bcolor="([^"]*)"/) || [])[1]).filter(Boolean);
    const cols = colors.length ? colors : ['#FFFFFF'];
    const usedIds = usedFil.map(s => +((s.match(/\bid="(\d+)"/) || [])[1])).filter(Boolean);
    // curr_bed_type (voller Name) → plate_1.json-Code (wie Studio)
    const bedMap = {
      'Textured PEI Plate': 'textured_plate', 'Textured Cool Plate': 'textured_cool_plate',
      'Cool Plate': 'cool_plate', 'Bambu Cool Plate': 'cool_plate',
      'Engineering Plate': 'eng_plate', 'Bambu Engineering Plate': 'eng_plate',
      'Smooth PEI Plate': 'hot_plate', 'High Temp Plate': 'hot_plate', 'Bambu Smooth PEI Plate': 'hot_plate',
      'Cool Plate (SuperTack)': 'supertack_plate', 'Bambu Cool Plate SuperTack': 'supertack_plate',
    };
    const btFull = (gc.match(/^; curr_bed_type = (.*)$/m) || [])[1] || 'Textured PEI Plate';
    const bt = bedMap[btFull] || 'textured_plate';
    // bbox aus first_layer_print_min/size (Header), sonst Default-Box
    const pmin = ((gc.match(/^; first_layer_print_min = (.*)$/m) || [])[1] || '').split(',').map(Number);
    const psz = ((gc.match(/^; first_layer_print_size = (.*)$/m) || [])[1] || '').split(',').map(Number);
    let bbox = [100, 100, 150, 150];
    if (pmin.length === 2 && psz.length === 2 && pmin.every(Number.isFinite) && psz.every(Number.isFinite))
      bbox = [pmin[0], pmin[1], pmin[0] + psz[0], pmin[1] + psz[1]];
    const objName = (si.match(/<object[^>]*name="([^"]*)"/) || [])[1] || 'object.stl';
    const plateJson = {
      bbox_all: bbox,
      bbox_objects: [{ area: (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]), bbox,
        id: 1, layer_height: 0.2, name: objName }],
      bed_type: bt,
      filament_colors: cols,
      filament_ids: usedIds.length === cols.length && usedIds.length ? usedIds : cols.map((_, i) => i + 1),
      first_extruder: usedIds.length ? usedIds[0] : 1,
      is_seq_print: false,
      nozzle_diameter: 0.4,
      version: 2,
    };
    fs.writeFileSync(path.join(work, 'Metadata/plate_1.json'), JSON.stringify(plateJson));
    execFileSync('zip', ['-q', copy, 'Metadata/plate_1.json'], { cwd: work, stdio: 'ignore' });
    plate = 1;
  } catch (e) { /* plate_1.json optional */ }

  execFileSync('zip', ['-q', copy, GCODE, GMD5], { cwd: work, stdio: 'ignore' });
  return { path: copy, added: 0, overridden: 0, gfix, psfix, plate };
}

module.exports = { injectMissingKeys };
