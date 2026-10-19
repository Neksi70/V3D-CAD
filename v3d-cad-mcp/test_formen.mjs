// Formwerkzeuge über das MCP-Protokoll: Drehen, Aushöhlen, Spiegeln, Muster, Import.
import { spawn } from 'child_process';
import { createInterface } from 'readline';

const srv = spawn('node', [new URL('./server.mjs', import.meta.url).pathname, '--no-monitor'], { stdio: ['pipe', 'pipe', 'inherit'] });
const rl = createInterface({ input: srv.stdout });
const waiting = new Map(); let nid = 1;
rl.on('line', l => { const m = JSON.parse(l); waiting.get(m.id)?.(m); waiting.delete(m.id); });
const rpc = (method, params) => new Promise(res => { const id = nid++; waiting.set(id, res); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const tool = async (name, args) => { const r = await rpc('tools/call', { name, arguments: args }); const t = r.result.content.find(c => c.type === 'text').text; return t.startsWith('Fehler') ? { ok: false, error: t } : JSON.parse(t); };
const ex = (command, params) => tool('execute', { command, params });
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const near = (a, b, rel) => Math.abs(a - b) <= Math.abs(b) * rel;
const PI = Math.PI;

try {
  await rpc('initialize', { protocolVersion: '2025-06-18' });

  // ── Drehen ──
  await ex('scene.new', {});
  let r = await ex('revolve', { profile: [[0, 0], [10, 0], [10, 20], [0, 20]] });
  ok(r.ok && near(r.result.volume_mm3, PI * 100 * 20, 0.01) && near(r.result.size[2], 20, 1e-3), `Drehen Zylinderprofil: ${r.result?.volume_mm3} ≈ ${(PI * 2000).toFixed(1)}`);
  // Kegelstumpf: π h/3 (R² + Rr + r²)
  r = await ex('revolve', { profile: [[0, 0], [15, 0], [5, 30], [0, 30]], center: [40, 0] });
  const vKegel = PI * 30 / 3 * (225 + 75 + 25);
  ok(r.ok && near(r.result.volume_mm3, vKegel, 0.01) && near(r.result.center[0], 40, 1e-3), `Drehen Kegelstumpf bei x=40: ${r.result?.volume_mm3} ≈ ${vKegel.toFixed(1)}`);
  r = await ex('revolve', { profile: [[0, 0], [10, 0], [10, 20], [0, 20]], center: [-40, 0], wall: 2 });
  ok(r.ok && r.result.volume_mm3 < PI * 2000 * 0.6, `Drehen mit Wand 2 mm (hohl): ${r.result?.volume_mm3}`);
  r = await ex('revolve', { profile: [[-1, 0], [10, 5]] });
  ok(!r.ok && /negativ/.test(r.error), 'Profil mit r < 0 → Meldung');

  // ── Aushöhlen ──
  await ex('scene.new', {});
  let b = (await ex('shape.add', { type: 'box', size: [40, 30, 20] })).result;
  r = await ex('body.shell', { id: b.id, thickness: 2 });
  ok(r.ok && near(r.result.volume_mm3, 24000 - 36 * 26 * 18, 0.002) && r.result.id === b.id, `Box ausgehöhlt, oben offen: ${r.result?.volume_mm3} ≈ ${24000 - 36 * 26 * 18}`);
  const z = (await ex('shape.add', { type: 'cylinder', size: [20, 20, 20], center: [50, 0, 10] })).result;
  r = await ex('body.shell', { id: z.id, thickness: 2, open: ['top', 'bottom'] });
  ok(r.ok && near(r.result.volume_mm3, PI * (100 - 64) * 20, 0.01), `Zylinder oben+unten offen = Rohr: ${r.result?.volume_mm3} ≈ ${(PI * 36 * 20).toFixed(1)}`);
  b = (await ex('shape.add', { type: 'box', size: [40, 30, 20], center: [0, 50, 10] })).result;
  await ex('body.fillet', { id: b.id, radius: 4, edges: 'vertical' });
  r = await ex('body.shell', { id: b.id, thickness: 2 });
  ok(r.ok && r.result.volume_mm3 > 5000 && r.result.volume_mm3 < 7152, `erst gerundet, dann ausgehöhlt: ${r.result?.volume_mm3}`);
  const b2 = (await ex('shape.add', { type: 'box', size: [40, 30, 20], center: [0, -50, 10] })).result;
  await ex('body.shell', { id: b2.id, thickness: 2 });
  r = await ex('body.fillet', { id: b2.id, radius: 4, edges: 'vertical' });
  ok(r.ok && r.result.volume_mm3 < 7152 && r.result.volume_mm3 > 5000, `erst ausgehöhlt, dann gerundet: ${r.ok ? r.result.volume_mm3 : r.error}`);
  r = await ex('body.shell', { id: b.id, thickness: 2, open: 'vorne' });
  ok(!r.ok && /erlaubt/.test(r.error), 'falsche Seite → Meldung');

  // ── Spiegeln ──
  await ex('scene.new', {});
  const L = (await ex('sketch.extrude', { outer: { polygon: [[5, 0], [25, 0], [25, 5], [10, 5], [10, 20], [5, 20]] }, height: 6 })).result;
  r = await ex('body.mirror', { id: L.id, plane: 'YZ', at: 5, copy: true });
  ok(r.ok && near(r.result.bbox.min[0], -15, 1e-3) && near(r.result.bbox.max[0], 5, 1e-3) && near(r.result.volume_mm3, L.volume_mm3, 1e-3), `gespiegelte Kopie: X ${r.result?.bbox.min[0]}…${r.result?.bbox.max[0]}, Vol ${r.result?.volume_mm3}`);
  const u = await ex('bool.union', { ids: [L.id, r.result.id] });
  ok(u.ok && near(u.result.created[0].volume_mm3, 2 * L.volume_mm3, 0.002), `Vereinen mit dem Spiegelbild (Normalen richtig): ${u.result?.created?.[0]?.volume_mm3} ≈ ${2 * L.volume_mm3}`);
  const w = (await ex('shape.add', { type: 'wedge', size: [20, 10, 10], center: [0, 40, 5] })).result;
  r = await ex('body.mirror', { id: w.id, plane: 'XY' });
  ok(r.ok && r.result.id === w.id && near(r.result.center[2], 5, 1e-3), 'an Ort und Stelle gespiegelt, id bleibt, Lage gleich');

  // ── Muster ──
  await ex('scene.new', {});
  const c = (await ex('shape.add', { type: 'cylinder', size: [6, 6, 10], center: [0, 0, 5] })).result;
  r = await ex('body.pattern', { id: c.id, linear: { count: 4, step: [15, 0, 0] } });
  ok(r.ok && r.result.copies === 3 && near(r.result.created[2].center[0], 45, 1e-3), 'lineares Muster: 3 Kopien, letzte bei x=45');
  const bx = (await ex('shape.add', { type: 'box', size: [10, 4, 4], center: [20, 0, 2] })).result;
  r = await ex('body.pattern', { id: bx.id, circular: { count: 4 } });
  const k1 = r.result.created[0];
  ok(r.ok && near(k1.center[1], 20, 1e-3) && Math.abs(k1.center[0]) < 1e-3 && String(k1.size) === '4,10,4', `Kreismuster: Kopie 1 bei ${k1.center}, Größe ${k1.size} (mitgedreht)`);
  const bx2 = (await ex('shape.add', { type: 'box', size: [10, 4, 4], center: [20, 60, 2] })).result;
  r = await ex('body.pattern', { id: bx2.id, circular: { count: 3, center: [0, 60, 0], angle: 90 } });
  ok(r.ok && near(r.result.created[1].center[1], 80, 1e-3), 'Teilkreis 90° mit 3 Stück: letzte Kopie bei y=80');
  const sp = (await ex('shape.add', { type: 'box', size: [10, 10, 10], center: [0, -40, 5] })).result;
  r = await ex('body.pattern', { id: sp.id, linear: { count: 3, step: [8, 0, 0] }, union: true });
  ok(r.ok && near(r.result.created[0].volume_mm3, 26 * 10 * 10, 0.002), `Muster vereint (überlappend): ${r.result?.created?.[0]?.volume_mm3} ≈ 2600`);

  // ── Import ──
  await ex('scene.new', {});
  const t = (await ex('shape.add', { type: 'box', size: [30, 20, 10] })).result;
  await ex('body.fillet', { id: t.id, radius: 2, edges: 'top' });
  const vOrig = (await ex('measure', {})).result.total.volume_mm3;
  for (const f of ['stl', '3mf', 'step']) {
    const e = await tool('export', { path: 'importtest.' + f });
    await ex('scene.new', {});
    r = await tool('import', { path: 'importtest.' + f, center: [10, 0] });
    const v = r.ok ? r.result.created.reduce((s, o) => s + o.volume_mm3, 0) : 0;
    ok(e.bytes > 0 && r.ok && near(v, vOrig, 0.01) && near(r.result.created[0].center[0], 10, 0.05), `Import ${f}: Vol ${v.toFixed?.(1)} ≈ ${vOrig}, Mitte x ${r.result?.created?.[0]?.center[0]}` + (r.ok ? '' : ' ' + r.error));
  }
  r = await tool('import', { path: '/etc/hosts' });
  ok(!r.ok && /nicht erlaubt/.test(r.error), 'Import außerhalb der erlaubten Ordner gesperrt');
} catch (e) { console.error(e); fail++; }
finally { srv.stdin.end(); setTimeout(() => process.exit(fail ? 1 : 0), 1500); }
console.log(fail ? `\n${fail} FEHLER` : '\nALLES OK');
