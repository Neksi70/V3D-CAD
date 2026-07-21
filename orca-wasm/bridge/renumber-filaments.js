// H2C-Vortek: 0-basiertes Filament-Layout auf Bambus 1-basiertes schieben.
// Bambu reserviert Filament 0 für die (ungenutzte) linke Düse; unsere erste Farbe
// ist Filament 0 = das Initial-Filament, das die Firmware beim letzten Laden anders
// behandelt → stg=4-Lade-Hänger bei Layer 49. Byte-Diff gegen Bambu: identisch AUSSER
// +1 auf jedem Filament-Index. Dieser Post-Process läuft auf dem FERTIGEN G-Code, NACH
// dem Slice — die App-seitige Farb-/Tray-Zuordnung (0-basiert, korrekt) bleibt unberührt.
//
// Nur echte FILAMENT-Index-Referenzen werden +1 geschoben, NICHT Geräte-Düsen/Arme/Modi:
//   JA:   T{n}(toolchange) · M620 S{n}A · M620.11 …I{n} B · M620.6 I{n} · M621 S{n}A ·
//         M632 S{n} · M640.8 T A{n} · G383… L{n}(Leveling-Filament)
//   NEIN: M104 T{n}(Düse) · M620.10 A0/A1(Spülarme) · G29 A{n}(Modus) · L0(Länge) · H{n}
'use strict';

// Eine G-Code-Zeile: Filament-Index-Referenzen um +1 schieben. digits: gültige Alt-Indizes.
function shiftGcodeLine(line, maxFil) {
  // Hilfsfunktion: n→n+1 nur wenn 0<=n<=maxFil (nicht T1000/T65535 etc.)
  const inc = (m, pre, n, post) => {
    const v = +n;
    return (v >= 0 && v <= maxFil) ? pre + (v + 1) + post : m;
  };
  // ^T{n}  (Toolchange) — nur einstellig 0..maxFil, gefolgt von Space/Ende
  line = line.replace(/^(T)([0-9]+)( |$)/, (m, p, n, s) => inc(m, p, n, s));
  // M620 S{n}A
  line = line.replace(/^(M620 S)([0-9]+)(A)/, (m, p, n, s) => inc(m, p, n, s));
  // M621 S{n}A
  line = line.replace(/^(M621 S)([0-9]+)(A)/, (m, p, n, s) => inc(m, p, n, s));
  // M620.6 I{n}   (…H… danach)
  line = line.replace(/^(M620\.6 I)([0-9]+)( )/, (m, p, n, s) => inc(m, p, n, s));
  // M620.11 …I{n} B   (die I direkt vor B ist der Filament-Index; L0 bleibt Länge)
  line = line.replace(/^(M620\.11 .*? I)([0-9]+)( B)/, (m, p, n, s) => inc(m, p, n, s));
  // M632 S{n}   (Vortek-Düsentausch)
  line = line.replace(/^(M632 S)([0-9]+)( )/, (m, p, n, s) => inc(m, p, n, s));
  // M640.8 T A{n}   (Initial-Filament fürs erste Homing)
  line = line.replace(/^(M640\.8 T A)([0-9]+)( )/, (m, p, n, s) => inc(m, p, n, s));
  // G383[.x] … L{n}   (Leveling mit Initial-Filament) — L am Zeilenende oder vor Space
  line = line.replace(/^(\s*G383[0-9.]* .*? L)([0-9]+)( |$)/, (m, p, n, s) => inc(m, p, n, s));
  return line;
}

// Config-Header-Zeile "; key = v0,v1,…" mit genau filCount Werten transformieren.
// Bambu-Referenz-Diff: unser Slicer legt die BENUTZTEN Farben nach vorne (Index 0..k-1)
// und füllt hinten mit Filler-Slots auf; Bambu reserviert Index 0 und legt die benutzten
// ab 1 — das ist exakt eine RECHTS-ROTATION um 1 (letzter Filler wandert nach vorne):
//   filament_colour  grün;blau;gelb;silber;grau → grau;grün;blau;gelb;silber   (= Bambu)
//   filament_ids     GFA00;GFA01;GFA00;GFA00;GFA00 → GFA00;GFA00;GFA01;GFA00;GFA00 (= Bambu)
// AUSNAHME filament_map: kein Rotieren, sondern benutzt→2 (rechts), Filler→1 (links),
//   wie Bambu (1,2,2,1,1). usedNew = geshiftete benutzte Indizes.
function shiftHeaderArray(line, filCount, usedNew) {
  const m = line.match(/^(; ([a-z_]+) = )(.*)$/);
  if (!m) return line;
  const key = m[2], val = m[3];
  const sep = val.includes(';') ? ';' : ',';
  const parts = val.split(sep);
  if (parts.length !== filCount) return line;           // nur echte per-Filament-Arrays
  if (key === 'filament_map')
    return m[1] + parts.map((_, i) => (usedNew.has(i) ? '2' : '1')).join(sep);
  // Rechts-Rotation: letztes Element nach vorne
  return m[1] + [parts[parts.length - 1], ...parts.slice(0, -1)].join(sep);
}

// Ganze plate_x.gcode transformieren. Gibt {gcode, filCount} zurück.
function renumberGcode(gcode) {
  // Filamentzahl aus filament_map-Header (verlässlich: genau ein Wert je Filament)
  const fmM = gcode.match(/^; filament_map = (.+)$/m);
  const filCount = fmM ? fmM[1].split(',').length : 0;
  if (filCount < 2) return { gcode, filCount, changed: false };
  const maxFil = filCount - 1;                            // gültige Alt-Indizes 0..maxFil
  // Benutzte Filament-Indizes aus den Kommandos (T{n} / M620 S{n}A) sammeln — im
  // ORIGINAL (0-basiert). usedOld → für den Guard; usedNew (+1) für filament_map.
  const usedOld = new Set();
  for (const line of gcode.split('\n')) {
    let x = line.match(/^T([0-9]+)( |$)/) || line.match(/^M620 S([0-9]+)A/);
    if (x) { const v = +x[1]; if (v >= 0 && v <= maxFil) usedOld.add(v); }
  }
  // GUARD: Der Shift (+1) und die Rechts-Rotation setzen voraus, dass der OBERSTE Slot
  // (maxFil) ein unbenutzter Filler ist (wandert bei der Rotation auf Index 0) und dass
  // KEIN benutztes Filament dort liegt (sonst würde T{maxFil}→T{filCount} aus dem Bereich
  // laufen bzw. die Rotation zwei Farben vertauschen). Trifft das nicht zu → NICHT
  // renumbern (unveränderten G-Code zurück, alte 0-basierte Kette bleibt gültig).
  if (usedOld.has(maxFil)) return { gcode, filCount, changed: false };
  const usedNew = new Set([...usedOld].map((v) => v + 1));
  const inHeader = (l) => l.startsWith('; ') && / = /.test(l);
  const out = gcode.split('\n').map((line) => {
    if (inHeader(line)) return shiftHeaderArray(line, filCount, usedNew);
    // "; filament: a,b" — 1-basierte Benutzt-Liste (Bambu: 2,3). Auch das +1 schieben.
    let fm;
    if ((fm = line.match(/^(; filament: )([0-9,]+)$/)))
      return fm[1] + fm[2].split(',').map((n) => +n + 1).join(',');
    if (line.startsWith(';') || line === '') return line; // andere Kommentare unberührt
    return shiftGcodeLine(line, maxFil);
  });
  return { gcode: out.join('\n'), filCount, changed: true };
}

// slice_info.config: KONSISTENT zum renumberGcode-Rotationsmodell auf 1-basiert schieben,
// damit buildAmsFieldsFromFile ein ams_mapping baut, dessen Indizes zu den G-Code-T-Befehlen
// passen (grün→Index 1, blau→Index 2; Index 0 = reservierter/leerer Slot → ams_mapping[0]=-1).
//   • <filament id="N">  → id="N+1"   (grün 1→2, blau 2→3)
//   • layer_filament_list "0 1" → "1 2"  (0-basierte Filament-Indizes +1)
//   • filament_maps  neu aufbauen: benutzter Slot→2 (rechts), Filler→1 (links) — wie Bambu
//     "1 2 2 1 1". Kein Platzhalter-<filament>, kein Wachstum: der fehlende id=1 wird von
//     buildAmsFieldsFromFile ohnehin zu ams_mapping[0]=-1.
function renumberSliceInfo(xml) {
  // 1) benutzte Slot-IDs (1-basiert) VOR dem Shift sammeln → nach Shift +1 = usedAfter
  const usedAfter = new Set();
  for (const m of xml.matchAll(/<filament\s+([^>]*?)\/?>/g)) {
    const id = +((m[1].match(/\bid="(\d+)"/) || [])[1]);
    if (id && /used_for_object="true"/.test(m[1])) usedAfter.add(id + 1);
  }
  // 2) filament_maps neu: Länge behalten, Position i (1-basiert) → 2 wenn benutzt sonst 1
  xml = xml.replace(/(<metadata key="filament_maps" value=")([^"]*)("\s*\/>)/, (m, a, v, b) => {
    const n = v.trim().split(/\s+/).length;
    return a + Array.from({ length: n }, (_, i) => (usedAfter.has(i + 1) ? '2' : '1')).join(' ') + b;
  });
  // 3) layer_filament_list: 0-basierte Indizes +1 (Trenner Space oder ';')
  xml = xml.replace(/(filament_list=")([^"]*)(")/g, (m, a, v, b) => {
    const sep = v.includes(';') ? ';' : ' ';
    return a + v.trim().split(/[\s;]+/).filter(s => s !== '').map(s => +s + 1).join(sep) + b;
  });
  // 4) alle <filament id="N"> → id="N+1" (rückwärts, damit sich Ersetzungen nicht überlappen)
  const ids = [...xml.matchAll(/<filament id="(\d+)"/g)].map((m) => +m[1]).sort((a, b) => b - a);
  for (const id of ids)
    xml = xml.replace(new RegExp('(<filament id=")' + id + '(")'), '$1' + (id + 1) + '$2');
  return xml;
}

module.exports = { renumberGcode, renumberSliceInfo, shiftGcodeLine, shiftHeaderArray };
