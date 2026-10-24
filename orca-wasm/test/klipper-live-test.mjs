// Test Klipper-Live (bridge/adapters/klipper-live.js) gegen eine Moonraker-Attrappe:
// welche Befehle kommen beim Drucker an, Grenzen, Sprungbegrenzung im Druck, Hilfe-Vorschläge, Profile (DB).
// Start: cd ~/orca-wasm && node test/klipper-live-test.mjs
import { createRequire } from 'node:module';
const K = createRequire(import.meta.url)('../bridge/adapters/klipper-live.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

const { st, db, scripts, close } = await (await import('./moonraker-mock.mjs')).startMock(17125);
const P = { id: 'test', ip: '127.0.0.1', port: 17125 };
try {
  let L = await K.readLive(P);
  ok(L.printing && L.extruder === 'extruder1' && L.material === 'PETG' && L.values.nozzle === 220 && L.values.pa === 0.03 && L.values.fan === 60, 'Live gelesen: aktiver Extruder 1, PETG, 220 °C, PA 0,03, Lüfter 60 %');

  let r = await K.applyChanges(P, { speed: 110, flow: 103, pa: 0.034 });
  ok(scripts.at(-1) === 'M220 S110\nM221 S103\nSET_PRESSURE_ADVANCE EXTRUDER=extruder1 ADVANCE=0.034', 'Befehle: ' + JSON.stringify(scripts.at(-1)));
  ok(r.live.values.speed === 110 && r.live.values.flow === 103, 'Werte wirken (neu gelesen)');

  r = await K.applyChanges(P, { flow: 150 });
  ok(r.applied.flow === 113 && r.notes.length, 'Fluss 150 % → im Druck nur +10 Schritt (' + r.applied.flow + ', ' + r.notes + ')');
  r = await K.applyChanges(P, { nozzle: 25 });
  ok(r.applied.nozzle === 200, 'Vertipper 25 °C im Druck → nur −20 Sprung auf 200 °C (' + r.applied.nozzle + ')');
  let e = null; try { await K.applyChanges(P, { nozzle: 0 }); } catch (x) { e = x; }
  ok(e && /gesperrt/.test(e.message), 'Düse aus im Druck gesperrt');
  e = null; try { await K.applyChanges(P, { gcode: 'G28' }); } catch (x) { e = x; }
  ok(e && /unbekannte/.test(e.message), 'beliebiger G-Code abgelehnt');
  e = null; try { await K.applyChanges(P, { speed: 'abc' }); } catch (x) { e = x; }
  ok(e && /keine Zahl/.test(e.message), 'keine Zahl abgelehnt');
  ok(!scripts.some(s => /G28|abc/.test(s)), 'nichts Gefährliches beim Drucker angekommen');

  L = await K.readLive(P);
  const s1 = K.suggest(L, 'stringing');
  ok(s1.wish.nozzle === L.values.nozzle - 5 && Math.abs(s1.wish.pa - (L.values.pa + 0.004)) < 1e-9, 'Hilfe Fäden: −5 °C, PA +0,004');
  const s2 = K.suggest(L, 'ghosting');
  ok(s2.wish.accel === 7000 && s2.wish.scv === 6, 'Hilfe Ghosting: Beschleunigung 7000, SCV 6');
  ok(s1.rows.every(x => x.from != null && x.label), 'Vorschlag mit vorher/nachher-Zeilen');

  // Profile
  ok(Object.keys(await K.listProfiles(P)).length === 0, 'leere DB → keine Profile');
  await K.saveProfile(P, 'PETG Halter <script>', { note: 'gut' });
  let all = await K.listProfiles(P);
  const nm = Object.keys(all)[0];
  ok(nm === 'PETG Halter script' && all[nm].values.flow === 113 && all[nm].material === 'PETG', 'Profil gespeichert (Name gesäubert, aktuelle Werte, Material)');
  ok(db['v3d/profiles'] && Object.keys(db).length === 1, 'nur Namespace v3d benutzt');
  st.gcode_move.extrude_factor = 1; st.gcode_move.speed_factor = 1;   // Drucker steht wieder auf 100 %
  r = await K.applyProfile(P, nm);
  ok(r.live.values.flow === 110 && r.notes.length, 'Profil angewendet (Sprung-Grenze greift im Druck: 100 → 110)');
  st.print_stats.state = 'standby'; st.extruder1.target = 0; st.heater_bed.target = 0;
  await K.saveProfile(P, 'leer');
  all = await K.listProfiles(P);
  ok(all.leer && all.leer.values.nozzle === undefined && all.leer.values.bed === undefined, 'Heizung aus (0 °C) landet nicht im Profil');
  r = await K.applyProfile(P, nm);
  ok(r.applied.flow === 113 && r.applied.nozzle === undefined && /kein Druck/.test(r.notes.join()), 'ohne Druck: Profil übernommen, aber Heizungen bleiben aus');
  L = await K.readLive(P);
  const s3 = K.suggest(L, 'stringing');
  ok(s3.wish.nozzle === undefined, 'Vorschlag schaltet ausgeschaltete Düse nicht ein');
  await K.deleteProfile(P, 'leer');
  ok(!('leer' in await K.listProfiles(P)), 'Profil gelöscht');
} finally { close(); }
console.log(fails ? `${fails} FEHLER` : 'alle grün'); process.exit(fails ? 1 : 0);
