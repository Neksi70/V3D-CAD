// Ende-zu-Ende-Test über das MCP-Protokoll (stdio), wie ein Agent es tun würde:
// Elektronikgehäuse 80×50×30, Wand 2, USB-Öffnung, 4 Schraubdome mit Loch.
// Prüft Volumen gegen den von Hand gerechneten Wert, Fehler-Rollback, Undo, Export.
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import fs from 'fs';

const srv = spawn('node', [new URL('./server.mjs', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'inherit'] });
const rl = createInterface({ input: srv.stdout });
const waiting = new Map(); let nid = 1;
rl.on('line', l => { const m = JSON.parse(l); waiting.get(m.id)?.(m); waiting.delete(m.id); });
const rpc = (method, params) => new Promise(res => { const id = nid++; waiting.set(id, res); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const tool = async (name, args) => {
  const r = await rpc('tools/call', { name, arguments: args });
  if (r.error) return { rpcError: r.error };
  const t = r.result.content.find(c => c.type === 'text');
  return { isError: !!r.result.isError, data: t ? JSON.parse(t.text.startsWith('Fehler') ? '{}' : t.text) : null, raw: r.result };
};
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test' } });
  ok(init.result?.serverInfo?.name === 'v3d-cad', 'initialize');
  const tl = await rpc('tools/list', {});
  ok(tl.result.tools.length >= 12, 'tools/list: ' + tl.result.tools.map(t => t.name).join(', '));

  const lc = await tool('list_commands', {});
  ok(lc.data.length >= 15, 'list_commands: ' + lc.data.length + ' Befehle');

  // Falsche Argumente → JSON-RPC-Fehler
  const bad = await tool('execute', { kommando: 'x' });
  ok(bad.rpcError?.code === -32602, 'Argumentprüfung: ' + bad.rpcError?.message);

  // Gehäuse in EINEM batch
  const W = 80, D = 50, H = 30, t = 2;
  const b = await tool('batch', { commands: [
    { command: 'shape.add', params: { type: 'box', size: [W, D, H], center: [0, 0, H / 2], name: 'Gehäuse' } },
    { command: 'shape.add', params: { type: 'box', size: [W - 2 * t, D - 2 * t, H], center: [0, 0, t + H / 2], hole: true, name: 'Innenraum' } },
  ] });
  ok(b.data.ok, 'batch Grundkörper + Innenraum');
  const [aussen, innen] = b.data.results.map(r => r.result);
  ok(near(aussen.size[0], 80, 0.01) && near(aussen.size[1], 50, 0.01) && near(aussen.size[2], 30, 0.01), 'Größe 80×50×30: ' + aussen.size);

  const s1 = await tool('execute', { command: 'bool.subtract', params: { target: aussen.id, tools: [innen.id] } });
  ok(s1.data.ok, 'Aushöhlen: ' + (s1.data.error || ''));
  let schale = s1.data.result.created[0];
  const vSchale = W * D * H - (W - 2 * t) * (D - 2 * t) * (H - t);
  ok(near(schale.volume_mm3, vSchale, vSchale * 0.002), `Schale Volumen ${schale.volume_mm3} ≈ ${vSchale}`);

  // USB-Öffnung 12×6 durch die Vorderwand (Y = -25), Mitte auf Z = 10
  const usb = await tool('batch', { commands: [
    { command: 'shape.add', params: { type: 'box', size: [12, 6, 6], center: [0, -D / 2, 10], hole: true, name: 'USB' } },
  ] });
  const s2 = await tool('execute', { command: 'bool.subtract', params: { target: schale.id, tools: [usb.data.results[0].result.id] } });
  ok(s2.data.ok, 'USB-Öffnung');
  schale = s2.data.result.created[0];
  const vUsb = vSchale - 12 * t * 6;
  ok(near(schale.volume_mm3, vUsb, vUsb * 0.002), `nach USB ${schale.volume_mm3} ≈ ${vUsb}`);

  // 4 Schraubdome Ø6, 10 hoch, auf dem Boden, mit Loch Ø2,5 — Dom + Kopien
  const dx = W / 2 - t - 5, dy = D / 2 - t - 5;
  const pos = [[-dx, -dy], [dx, -dy], [-dx, dy], [dx, dy]];
  const dome = await tool('batch', { commands: pos.flatMap(([x, y]) => [
    { command: 'shape.add', params: { type: 'cylinder', size: [6, 6, 10], center: [x, y, t + 5], name: 'Dom' } },
  ]) });
  ok(dome.data.ok, '4 Dome angelegt');
  const domeIds = dome.data.results.map(r => r.result.id);
  const u = await tool('execute', { command: 'bool.union', params: { ids: [schale.id, ...domeIds] } });
  ok(u.data.ok, 'Dome vereinen: ' + (u.data.error || ''));
  schale = u.data.result.created[0];
  const holes = await tool('batch', { commands: pos.map(([x, y]) =>
    ({ command: 'shape.add', params: { type: 'cylinder', size: [2.5, 2.5, 10], center: [x, y, t + 5 + 0.5], hole: true } })) });
  const s3 = await tool('execute', { command: 'bool.subtract', params: { target: schale.id, tools: holes.data.results.map(r => r.result.id) } });
  ok(s3.data.ok, 'Schraublöcher');
  schale = s3.data.result.created[0];
  // Zylinder ist ein Vieleck (Segmente) → Toleranz 1 %
  const vDom = Math.PI * 9 * 10, vLoch = Math.PI * 1.5625 * 10;
  const vEnd = vUsb + 4 * vDom - 4 * vLoch;
  ok(near(schale.volume_mm3, vEnd, vEnd * 0.01), `Endvolumen ${schale.volume_mm3} ≈ ${vEnd.toFixed(1)}`);

  // Fehler im batch → alles zurück
  const before = (await tool('inspect_scene', {})).data.result.bodies.length;
  const rb = await tool('batch', { commands: [
    { command: 'shape.add', params: { type: 'sphere', size: [10, 10, 10] } },
    { command: 'bool.union', params: { ids: [999999] } },
  ] });
  const after = (await tool('inspect_scene', {})).data.result.bodies.length;
  ok(!rb.data.ok && rb.isError && rb.data.failed.index === 1 && after === before, `Rollback: ${rb.data.failed?.error} (Körper ${before}→${after})`);
  const unk = await tool('execute', { command: 'bool.unoin', params: {} });
  ok(unk.isError && /meintest du/.test(unk.data.error), 'Tippfehler-Vorschlag: ' + unk.data.error);

  // Undo nimmt genau den letzten Schritt (Schraublöcher) zurück
  await tool('undo', {});
  const sc = (await tool('inspect_scene', {})).data.result.bodies;
  ok(sc.length === 5 && sc.filter(b => b.hole).length === 4, 'Undo: Schale + 4 Lochzylinder wieder da (' + sc.length + ')');
  await tool('redo', {});

  const shot = await tool('screenshot', { view: 'iso', width: 480, height: 320, path: 'gehaeuse.png' });
  const img = shot.raw.content.find(c => c.type === 'image');
  ok(img && img.data.length > 5000, 'Screenshot ' + (img ? Math.round(img.data.length * 0.75 / 1024) + ' KB' : 'fehlt'));

  const ex = await tool('export', { path: 'gehaeuse.stl' });
  ok(ex.data?.bytes > 1000 && fs.existsSync(ex.data.path), 'STL-Export ' + ex.data?.path + ' ' + ex.data?.bytes + ' B');
  const ex3 = await tool('export', { path: 'gehaeuse.3mf' });
  ok(ex3.data?.bytes > 500, '3MF-Export ' + ex3.data?.bytes + ' B');
  const exs = await tool('export', { path: 'gehaeuse.step' });
  ok(exs.data?.bytes > 1000, 'STEP-Export ' + (exs.data?.bytes || JSON.stringify(exs.raw.content[0].text).slice(0, 200)));
  const bad2 = await tool('export', { path: '/etc/passwd' });
  ok(bad2.isError, 'Pfadsperre greift');
  // Speichern/Laden + Drehungen um Welt-Achsen
  const sv = await tool('save', { path: 'gehaeuse.json' });
  ok(sv.data?.bytes > 100, 'Szene gespeichert');
  await tool('new_scene', {});
  const op = await tool('open', { path: 'gehaeuse.json' });
  const vol2 = (await tool('measure', {})).data.result.total.volume_mm3;
  ok(op.data.ok && near(vol2, vEnd, vEnd * 0.01), 'Szene geladen, Volumen ' + vol2);
  await tool('new_scene', {});
  const rot = await tool('batch', { commands: [
    { command: 'shape.add', params: { type: 'box', size: [40, 20, 10], rotation: [0, 0, 90] } },
    { command: 'shape.add', params: { type: 'box', size: [40, 20, 10], rotation: [90, 0, 0], center: [60, 0, 20] } },
    { command: 'shape.add', params: { type: 'box', size: [40, 20, 10], rotation: [0, 90, 0], center: [-60, 0, 30] } },
  ] });
  const [rz, rx, ry] = rot.data.results.map(r => r.result);
  ok(String(rz.size) === '20,40,10' && String(rz.rotation) === '0,0,90', 'Drehung Z 90°: ' + rz.size + ' / ' + rz.rotation);
  ok(String(rx.size) === '40,10,20' && String(rx.rotation) === '90,0,0', 'Drehung X 90°: ' + rx.size + ' / ' + rx.rotation);
  ok(String(ry.size) === '10,20,40' && String(ry.rotation) === '0,90,0', 'Drehung Y 90°: ' + ry.size + ' / ' + ry.rotation);
  const mv = await tool('execute', { command: 'body.transform', params: { id: rz.id, move: [5, 0, 0], drop: true } });
  ok(near(mv.data.result.center[0], 5, 1e-3) && near(mv.data.result.bbox.min[2], 0, 1e-3), 'Verschieben + auf die Platte: ' + mv.data.result.center);
} catch (e) { console.error(e); fail++; }
finally { srv.stdin.end(); setTimeout(() => process.exit(fail ? 1 : 0), 1500); }
console.log(fail ? `\n${fail} FEHLER` : '\nALLES OK');
