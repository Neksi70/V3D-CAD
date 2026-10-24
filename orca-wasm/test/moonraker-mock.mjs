// Moonraker-Attrappe für Tests (Werte wie am echten U1 gelesen). startMock(port) → { st, db, scripts, close }
import http from 'node:http';
export async function startMock(port = 17125) {
  // --- Moonraker-Attrappe (Werte wie am echten U1 gelesen) ---
  const st = { print_stats: { state: 'printing', filename: 'halter.gcode', info: { current_layer: 12, total_layer: 80 } },
    virtual_sdcard: { is_active: true, progress: 0.15 }, gcode_move: { speed_factor: 1, extrude_factor: 1 },
    toolhead: { extruder: 'extruder1', max_velocity: 500, max_accel: 10000, square_corner_velocity: 8 },
    fan: { speed: 0.6 }, heater_bed: { target: 60, temperature: 59.8 },
    extruder: { target: 0, temperature: 25, pressure_advance: 0.022 }, extruder1: { target: 220, temperature: 219.5, pressure_advance: 0.03 },
    print_task_config: { filament_type: ['PLA', 'PETG', 'PLA', 'PLA'] } };
  const db = {}; const scripts = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let body = '';
    req.on('data', c => body += c); req.on('end', () => {
      const send = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (u.pathname === '/printer/objects/query') return send(200, { result: { status: JSON.parse(JSON.stringify(st)) } });
      if (u.pathname === '/printer/gcode/script') {
        const sc = u.searchParams.get('script'); scripts.push(sc);
        for (const l of sc.split('\n')) {   // Wirkung wie Klipper
          let m;
          if ((m = l.match(/^M220 S([\d.]+)$/))) st.gcode_move.speed_factor = m[1] / 100;
          else if ((m = l.match(/^M221 S([\d.]+)$/))) st.gcode_move.extrude_factor = m[1] / 100;
          else if ((m = l.match(/^M106 S([\d.]+)$/))) st.fan.speed = m[1] / 255;
          else if ((m = l.match(/^SET_HEATER_TEMPERATURE HEATER=(\w+) TARGET=([\d.]+)$/))) st[m[1]].target = +m[2];
          else if ((m = l.match(/^SET_PRESSURE_ADVANCE EXTRUDER=(\w+) ADVANCE=([\d.]+)$/))) st[m[1]].pressure_advance = +m[2];
          else if ((m = l.match(/^SET_VELOCITY_LIMIT (ACCEL|VELOCITY|SQUARE_CORNER_VELOCITY)=([\d.]+)$/))) st.toolhead[{ ACCEL: 'max_accel', VELOCITY: 'max_velocity', SQUARE_CORNER_VELOCITY: 'square_corner_velocity' }[m[1]]] = +m[2];
          else return send(400, { error: 'unbekannt: ' + l });
        }
        return send(200, { result: 'ok' });
      }
      if (u.pathname === '/server/database/item') {
        if (req.method === 'GET') { const v = db[u.searchParams.get('namespace') + '/' + u.searchParams.get('key')]; return v ? send(200, { result: { value: v } }) : send(404, { error: 'not found' }); }
        const j = JSON.parse(body); db[j.namespace + '/' + j.key] = j.value; return send(200, { result: { value: j.value } });
      }
      send(404, {});
    });
  });
  await new Promise(r => srv.listen(port, '127.0.0.1', r));
  return { st, db, scripts, close: () => srv.close() };
}
