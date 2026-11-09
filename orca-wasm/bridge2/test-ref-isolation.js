#!/usr/bin/env node
// ISOLATIONS-TEST für den AMS-Ladefehler 0x7008012 ("AMS-Zuordnungstabelle nicht abrufbar").
//
// Idee: Studios EIGENE, per Bambu Studio erfolgreich gedruckte Datei (studio_ref.gcode.3mf)
// durch UNSERE Transport-/Kommando-Pipeline schicken. Das bisektiert das Problem sauber:
//   - Scheitert es MIT unserer Pipeline trotz Studios Datei → Fehler in Kommando/Transport.
//   - Druckt es → unsere Datei-Generierung hat einen echten (nicht kosmetischen) Bug.
//
// Quellenlage (OrcaSlicer-Git + ClusterM/open-bamboo-networking, geprüft 2026-07-19):
//   LAN-AMS-Druck = Datei hochladen + EIN project_file (mit ams_mapping/ams_mapping2).
//   KEIN get_auto_nozzle_mapping, KEIN separates AMS-Kommando, KEINE Cloud.
//   Deshalb ist die Query hier per Default AUS.
//
// Aufruf:
//   node test-ref-isolation.js [emmc|ftp] [query|noquery] [gid]
//   Default: emmc noquery 0   (0 = grün GFA00 in AMS-Slot 0)
// STARTET EINEN ECHTEN DRUCK. Drucker muss bereit sein (Platte leer, AMS bestückt).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const lan = require('./lan');

const PRINTER = { ip: '192.168.178.175', access_code: 'cb5f0251', serial: '31B8BP5B2601310' };
// Default = Studios Referenz; via VS_REF=<pfad> auf unsere eigene (gefixte) Datei umstellen.
const REF = process.env.VS_REF || '/tmp/claude-1000/-home-v3da/bdbc9fc6-d2f0-4d4e-b71a-1872e145755b/scratchpad/studio_ref.gcode.3mf';

const transport = (process.argv[2] || 'emmc').toLowerCase();   // emmc | ftp
const useQuery  = (process.argv[3] || 'noquery') === 'query';
const GID       = Number(process.argv[4] != null ? process.argv[4] : 0); // AMS-Tray-gid des benutzten Filaments

// AMS-Felder aus studio_ref bauen (exakt wie server.js buildAmsFieldsFromFile)
function buildAms(file, gid, tar) {
  const si = execFileSync('unzip', ['-p', file, 'Metadata/slice_info.config'], { maxBuffer: 1 << 24 }).toString();
  const fm = (si.match(/filament_maps"\s+value="([^"]*)"/) || [])[1].trim().split(/\s+/).map(Number);
  const N = fm.length;
  const usedIds = [];
  for (const m of si.matchAll(/<filament\s+([^>]*?)\/?>/g)) {
    const id = +((m[1].match(/\bid="(\d+)"/) || [])[1]);
    if (id && /used_for_object="true"/.test(m[1])) usedIds.push(id);
  }
  usedIds.sort((a, b) => a - b);
  const trayBySlot = {}; usedIds.forEach((slot, i) => trayBySlot[slot] = i === 0 ? gid : gid);
  const v0 = [], v1 = [], nozMap = new Array(32).fill(-1);
  for (let slot = 1; slot <= N; slot++) {
    const g = trayBySlot[slot];
    if (g != null) {
      v0.push(g);
      v1.push(g >= 254 ? { ams_id: g, slot_id: 0 } : { ams_id: Math.floor(g / 4), slot_id: g % 4 });
      if (slot - 1 < 32) nozMap[slot - 1] = tar;
    } else { v0.push(-1); v1.push({ ams_id: 0xff, slot_id: 0xff }); }
  }
  return { ams_mapping: v0, ams_mapping2: v1, nozzle_mapping: nozMap, usedIds, fm };
}

async function main() {
  const buf = fs.readFileSync(REF);
  const name = 'studioref-' + Date.now().toString(36).slice(-4) + '.gcode.3mf';
  const md5 = crypto.createHash('md5').update(buf).digest('hex').toUpperCase();

  // aktive Düsen-Position
  let tar = 17;
  try { const st = await lan.getStatus(PRINTER, 6000);
    const t = (st.device?.nozzle || st.nozzle || {}).tar_id; if (Number.isFinite(t)) tar = t; } catch {}
  const ams = buildAms(REF, GID, tar);
  console.log('[ref-test] transport=%s query=%s gid=%d tar=%d', transport, useQuery, GID, tar);
  console.log('[ref-test] used-slots=%j filament_maps=%j', ams.usedIds, ams.fm);
  console.log('[ref-test] ams_mapping=%j', ams.ams_mapping);
  console.log('[ref-test] ams_mapping2=%j', ams.ams_mapping2);

  // Upload
  let url;
  if (transport === 'emmc') {
    const tmp = path.join(require('os').tmpdir(), name);
    fs.writeFileSync(tmp, buf);
    execFileSync('python3', [path.join(__dirname, 'emmc_upload.py'), PRINTER.ip, PRINTER.access_code, tmp, name], { timeout: 120000 });
    fs.unlinkSync(tmp);
    url = `brtc://emmc/${name}`;
    console.log('[ref-test] emmc-Upload ok →', url);
  } else {
    await lan.uploadGcode(PRINTER, name, buf, () => {});
    url = `ftp://${name}`;
    console.log('[ref-test] ftp-Upload ok →', url);
  }

  // project_file — Felder wie Studios Mitschnitt / OBN build_project_file_json
  const proj = { print: {
    sequence_id: '0', command: 'project_file', param: 'Metadata/plate_1.gcode',
    project_id: '0', profile_id: '0', task_id: '0', subtask_id: '0',
    subtask_name: name.replace('.gcode.3mf', ''), file: name, url, md5,
    bed_type: 'textured_plate', bed_leveling: true, flow_cali: false, vibration_cali: false,
    layer_inspect: true, timelapse: false, use_ams: true,
    ams_mapping: ams.ams_mapping, ams_mapping2: ams.ams_mapping2, nozzle_mapping: ams.nozzle_mapping,
    auto_bed_leveling: 2, nozzle_offset_cali: 0, extrude_cali_flag: 2, cfg: '0',
  } };

  let pr;
  if (useQuery) {
    const q = { command: 'get_auto_nozzle_mapping', sequence_id: '0', calibration: 2,
      extrude_cali_manual_mode: 0, filament_seq: [-1, -1, 0],
      ams_mapping: (() => { const a = new Array(33).fill(65535); ams.usedIds.forEach((s) => a[s] = GID); return a; })(),
      fila_info: ams.usedIds.map((s) => ({ cate: 'GFA00', color: '0ACC38FF', direction: ams.fm[s - 1] || 2, group: 1, id: s, nozzle_d: '0.40', nozzle_v: 'Standard' })),
      nozzle_info: [] };
    pr = await lan.sendSequence(PRINTER, [{ payload: { print: q }, gapMs: 3000 }, { payload: proj }], { finalWaitMs: 10000 });
  } else {
    pr = await lan.sendCommand(PRINTER, proj, { waitMs: 10000 });
  }
  console.log('[ref-test] project_file result=%s reason=%s', pr?.result, pr?.reason || '');

  // Status nach 12s: gcode_state + print_error
  await new Promise((r) => setTimeout(r, 12000));
  try { const st = await lan.getStatus(PRINTER, 8000);
    console.log('[ref-test] gcode_state=%s print_error=%s stg_cur=%s',
      st.gcode_state, st.print_error, st.stg_cur);
  } catch (e) { console.log('[ref-test] Status-Fehler:', e.message); }
  process.exit(0);
}
main().catch((e) => { console.error('[ref-test] FEHLER:', e.message); process.exit(1); });
