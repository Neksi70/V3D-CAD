#!/usr/bin/env node
// Druck-Wächter — stoppt hängende Drucke automatisch.
//
// HINTERGRUND: Der H2C blieb mehrfach in der AMS-Ladephase (stg_cur=4) stehen und
// hielt dabei STUNDENLANG Düse 210 °C + Bett 60 °C, weil niemand davorstand. Dieser
// Dienst erkennt genau das und schickt selbst den stop-Befehl.
//
// ERKENNUNG (bewusst eng, damit KEIN laufender Druck fälschlich gekillt wird):
//   gcode_state == RUNNING  UND  stg_cur == 4 (Filament-Ladephase)
//   UND layer_num unverändert  → länger als HANG_MIN Minuten
// Ein normaler AMS-Load dauert < 2 min; 15 min sind also weit jenseits von echt.
// Sobald sich der Layer ändert oder die Phase wechselt, wird der Zähler zurückgesetzt.
//
// Drucker kommen aus bridge/lan-auth.json (dieselbe Quelle wie die Bridge).
// ENV: WATCHDOG_POLL_S (60), WATCHDOG_HANG_MIN (15), WATCHDOG_DRY_RUN (1 = nur loggen)

'use strict';
const fs = require('fs');
const path = require('path');
const lan = require('./lan.js');

const LANAUTH = path.join(__dirname, 'lan-auth.json');
const LOG = process.env.WATCHDOG_LOG || path.join(__dirname, '..', 'print-watchdog.log');
const POLL_MS = (Number(process.env.WATCHDOG_POLL_S) || 60) * 1000;
const HANG_MIN = Number(process.env.WATCHDOG_HANG_MIN) || 15;
const DRY_RUN = process.env.WATCHDOG_DRY_RUN === '1';

const log = (msg) => {
  const line = new Date().toISOString().replace('T', ' ').slice(0, 19) + '  ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch {}
};

function printers() {
  try {
    return JSON.parse(fs.readFileSync(LANAUTH, 'utf8'))
      .map(([serial, v]) => ({ serial, ip: v.ip, access_code: v.code, dev_id: serial }))
      .filter((p) => p.ip && p.access_code);
  } catch (e) { log('lan-auth.json nicht lesbar: ' + e.message); return []; }
}

// Zustand je Drucker: seit wann steckt er in stg=4 auf demselben Layer?
const state = new Map();

async function check(p) {
  let pr;
  try { const st = await lan.getStatus(p, 12000); pr = st.print || st; }
  catch (e) { return; }                       // unerreichbar → still übergehen
  if (!pr) return;

  const key = p.serial;
  const s = state.get(key) || { since: 0, layer: -1, stopped: false };
  const running = pr.gcode_state === 'RUNNING';
  const loading = Number(pr.stg_cur) === 4;

  if (!running) {                              // nicht am Drucken → alles zurücksetzen
    if (s.stopped || s.since) state.set(key, { since: 0, layer: -1, stopped: false });
    return;
  }
  if (!loading || pr.layer_num !== s.layer) {  // Fortschritt oder andere Phase → Zähler neu
    state.set(key, { since: loading ? Date.now() : 0, layer: pr.layer_num, stopped: false });
    return;
  }
  if (!s.since) { state.set(key, { ...s, since: Date.now() }); return; }

  const stuckMin = (Date.now() - s.since) / 60000;
  if (stuckMin < HANG_MIN || s.stopped) return;

  log(`HÄNGER erkannt: ${p.serial} steht ${stuckMin.toFixed(0)} min in Ladephase (stg=4) ` +
      `bei Layer ${pr.layer_num}/${pr.total_layer_num}, Düse ${pr.nozzle_temper}->${pr.nozzle_target_temper}, ` +
      `Job "${pr.subtask_name}"`);
  if (DRY_RUN) { log('  DRY_RUN: würde jetzt stoppen (kein Befehl gesendet)'); state.set(key, { ...s, stopped: true }); return; }

  try {
    await lan.sendCommand(p, { print: { sequence_id: '0', command: 'stop' } }, { waitMs: 8000 });
    log('  → stop gesendet.');
    state.set(key, { ...s, stopped: true });
    setTimeout(async () => {                   // nachsehen, ob die Heizung wirklich aus ist
      try {
        const st2 = await lan.getStatus(p, 10000); const q = st2.print || st2;
        log(`  Kontrolle: state=${q.gcode_state} Düse ${q.nozzle_temper}->${q.nozzle_target_temper} ` +
            `Bett ${q.bed_temper}->${q.bed_target_temper}` +
            (Number(q.nozzle_target_temper) === 0 ? '  ✓ Heizung aus' : '  ⚠ heizt noch!'));
      } catch {}
    }, 15000);
  } catch (e) { log('  stop FEHLGESCHLAGEN: ' + e.message); }
}

async function tick() {
  for (const p of printers()) await check(p);
  setTimeout(tick, POLL_MS);
}

log(`Druck-Wächter gestartet (Poll ${POLL_MS / 1000}s, Hänger-Schwelle ${HANG_MIN} min` +
    (DRY_RUN ? ', DRY_RUN' : '') + `). Überwacht: ${printers().map((p) => p.serial).join(', ') || 'keine'}`);
tick();
