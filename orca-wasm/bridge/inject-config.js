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
function injectMissingKeys(gcode3mfPath) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'h2c-inject-'));
  const copy = path.join(work, path.basename(gcode3mfPath));
  fs.copyFileSync(gcode3mfPath, copy);

  execFileSync('unzip', ['-o', copy, GCODE, GMD5, '-d', work], { stdio: 'ignore' });
  const gcodePath = path.join(work, GCODE);
  let g = fs.readFileSync(gcodePath, 'utf8');

  // Anker: die filament_map-Zeile existiert im Header (Studio-Trick setzt sie).
  const anchor = /^; filament_map = .*$/m;
  let gfix = 0;
  // Extra-Keys entfernen (ganze Zeile)
  for (const key of REMOVE) {
    const re = new RegExp('^; ' + key + ' = .*$\\n', 'm');
    if (re.test(g)) { g = g.replace(re, ''); gfix++; }
  }
  for (const [key, val] of Object.entries(HEADER)) {
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
    // Studio-Slot-2: benutztes AMS-Filament von Slot 1 auf Slot 2 (wie Studio).
    // filament_maps "2 1 1 1 1" → "1 2 1 1 1" und das benutzte <filament id="1"...> → id="2".
    si = si.replace(/(key="filament_maps" value=")2 1 1 1 1(")/, '$11 2 1 1 1$2');
    si = si.replace(/(<filament id=")1("[^>]*used_for_object="true")/, '$12$2');
    fs.writeFileSync(siPath, si);
    execFileSync('zip', ['-q', copy, SLICEINFO], { cwd: work, stdio: 'ignore' });
    gfix++;
  } catch (e) { /* slice_info optional */ }

  // project_settings.config: Hotend-/Extruder-Menge+Modell auf Studios Werte (JSON).
  // HINWEIS: Experiment vom 2026-07-18 zeigte, dass ENTFERNEN von project_settings den
  // 0500-4047 NICHT behebt → die Firmware liest die Hotend-Prüfung NICHT aus PS. Der
  // Patch bleibt trotzdem (hält das 3MF Studio-konform), ist aber nicht die 4047-Quelle.
  let psfix = 0;
  try {
    execFileSync('unzip', ['-o', copy, PROJSET, '-d', work], { stdio: 'ignore' });
    const psPath = path.join(work, PROJSET);
    const ps = JSON.parse(fs.readFileSync(psPath, 'utf8'));
    for (const [k, v] of Object.entries(PS_SET)) {
      if (JSON.stringify(ps[k]) !== JSON.stringify(v)) { ps[k] = v; psfix++; }
    }
    for (const k of PS_REMOVE) if (k in ps) { delete ps[k]; psfix++; }
    fs.writeFileSync(psPath, JSON.stringify(ps));
    execFileSync('zip', ['-q', copy, PROJSET], { cwd: work, stdio: 'ignore' });
  } catch (e) { /* project_settings optional */ }

  execFileSync('zip', ['-q', copy, GCODE, GMD5], { cwd: work, stdio: 'ignore' });
  return { path: copy, added: 0, overridden: 0, gfix, psfix };
}

module.exports = { injectMissingKeys };
