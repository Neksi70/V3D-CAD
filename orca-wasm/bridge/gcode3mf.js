// Verpackt rohen G-Code als .gcode.3mf, wie Bambu Studio es aufs Gerät legt.
// Neuere Firmware (H2-Serie u. a.) startet project_file nur aus einem 3MF-
// Paket (param = Metadata/plate_1.gcode) — rohes .gcode wird still ignoriert.
// Struktur nachgebaut von einer echten Studio-Datei vom H2C (siehe Commit).
// ZIP im Store-Modus, damit kein Zusatzpaket nötig ist.
const crypto = require('crypto');

// ---- Mini-ZIP (nur Store) ----
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(files) {   // files: [{ name, data: Buffer }]
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const nameB = Buffer.from(f.name);
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);                    // version needed
    lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);   // flags, method: store
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12);  // DOS-Zeit/-Datum (1980-01-01)
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(f.data.length, 18); lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(nameB.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, nameB, f.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(f.data.length, 20); ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(nameB.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameB);
    offset += 30 + nameB.length + f.data.length;
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

// ---- G-Code-Header lesen (Orca schreibt "; key = value" bzw. Sonderzeilen) ----
const headerVal = (g, key) => {
  const m = g.match(new RegExp('^; ' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' = (.*)$', 'm'));
  return m ? m[1].trim() : '';
};
function estSeconds(g) {
  const m = g.match(/; total estimated time: (?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?(\d+)s/);
  return m ? (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+m[4]) : 0;
}
const splitList = (s) => s.split(/[;,]/).map(x => x.trim()).filter(Boolean);

// gcodeBuf → fertiges .gcode.3mf; meta: { modelId, settings }
//   modelId  z. B. "O1C2" (optional)
//   settings die vollständige, gemergte Slicer-Config (machine+process+filament)
//            als Objekt — wird zu Metadata/project_settings.config. OHNE diese
//            Datei lehnt die H2-Firmware das 3MF ab ("3MF-Datei ungültig").
function wrap(gcodeBuf, meta = {}) {
  // Konfig-Zeilen stehen am Anfang, die Verbrauchsstatistik im Fußteil
  const head = gcodeBuf.slice(0, 65536).toString('utf8')
    + '\n' + gcodeBuf.slice(Math.max(0, gcodeBuf.length - 65536)).toString('utf8');
  const colors = splitList(headerVal(head, 'filament_colour'));
  const types = splitList(headerVal(head, 'filament_type'));
  const diams = splitList(headerVal(head, 'nozzle_diameter'));
  const grams = splitList(headerVal(head, 'filament used [g]'));
  const meters = splitList(headerVal(head, 'filament used [mm]')).map(v => (parseFloat(v) / 1000).toFixed(2));
  const totalG = grams.reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const pred = estSeconds(head);
  const nFil = Math.max(colors.length, types.length, 1);
  const fil = (i) =>
    `    <filament id="${i + 1}" tray_info_idx="" type="${types[i] || types[0] || 'PLA'}" color="${colors[i] || '#2EA2D8'}"` +
    ` used_m="${meters[i] || '0'}" used_g="${grams[i] || '0'}" nozzle_diameter="${diams[0] || '0.4'}" volume_type="Standard"/>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
 <metadata name="Application">VolmeSlice</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>
 </resources>
 <build/>
</model>`;
  const modelSettings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <metadata key="gcode_file" value="Metadata/plate_1.gcode"/>
    <metadata key="pattern_bbox_file" value="Metadata/plate_1.json"/>
  </plate>
</config>`;
  const plateJson = JSON.stringify({
    bbox_all: [], bbox_objects: [], bed_type: 'textured_plate',
    filament_colors: colors.length ? colors : ['#2EA2D8'],
    filament_ids: Array.from({ length: nFil }, (_, i) => i),
    first_extruder: 0, is_seq_print: false,
    nozzle_diameter: parseFloat(diams[0]) || 0.4, version: 2,
  });
  const sliceInfo = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="02.07.01.57"/>
  </header>
  <plate>
    <metadata key="index" value="1"/>
${meta.modelId ? `    <metadata key="printer_model_id" value="${meta.modelId}"/>\n` : ''}    <metadata key="nozzle_diameters" value="${diams.join(',') || '0.4'}"/>
    <metadata key="timelapse_type" value="0"/>
    <metadata key="prediction" value="${pred}"/>
    <metadata key="weight" value="${totalG.toFixed(2)}"/>
    <metadata key="outside" value="false"/>
    <metadata key="support_used" value="false"/>
    <metadata key="label_object_enabled" value="false"/>
${Array.from({ length: nFil }, (_, i) => fil(i)).join('\n')}
  </plate>
</config>`;
  const md5 = crypto.createHash('md5').update(gcodeBuf).digest('hex').toUpperCase();

  // model_settings.config verweist per rels auf den G-Code (wie Studio)
  const modelRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/Metadata/plate_1.gcode" Id="rel-1" Type="http://schemas.bambulab.com/package/2021/gcode"/>
</Relationships>`;
  const cutInfo = `<?xml version="1.0" encoding="utf-8"?>
<objects>
 <object id="1">
  <cut_id id="0" check_sum="1" connectors_cnt="0"/>
 </object>
</objects>`;
  const filamentSeq = JSON.stringify({ plate_1: {
    nozzle_sequence: [0],
    optimal_assignment: Array(9).fill(0),
    sequence: Array.from({ length: nFil }, (_, i) => i + 1),
  } });

  const files = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes) },
    { name: '_rels/.rels', data: Buffer.from(rels) },
    { name: '3D/3dmodel.model', data: Buffer.from(model) },
    { name: 'Metadata/model_settings.config', data: Buffer.from(modelSettings) },
    { name: 'Metadata/_rels/model_settings.config.rels', data: Buffer.from(modelRels) },
    { name: 'Metadata/plate_1.json', data: Buffer.from(plateJson) },
    { name: 'Metadata/slice_info.config', data: Buffer.from(sliceInfo) },
    { name: 'Metadata/cut_information.xml', data: Buffer.from(cutInfo) },
    { name: 'Metadata/filament_sequence.json', data: Buffer.from(filamentSeq) },
    { name: 'Metadata/plate_1.gcode', data: gcodeBuf },
    { name: 'Metadata/plate_1.gcode.md5', data: Buffer.from(md5) },
  ];
  // project_settings.config: die vollständige Slicer-Config. Ohne sie ist das
  // 3MF für die H2-Firmware ungültig. Die App liefert die gemergte Config.
  if (meta.settings && typeof meta.settings === 'object') {
    const ps = { ...meta.settings, from: 'project', name: 'project_settings' };
    files.push({ name: 'Metadata/project_settings.config',
                 data: Buffer.from(JSON.stringify(ps, null, 4)) });
  }
  return zipStore(files);
}

module.exports = { wrap };
