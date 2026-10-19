// Rest der SolidCraft-Lücken: Flächen, Skizzen mit Bedingungen, genaues Messen, Kamera/Schnitt, kompakte Antworten.
import { spawn } from 'child_process';
import { createInterface } from 'readline';

const srv = spawn('node', [new URL('./server.mjs', import.meta.url).pathname, '--no-monitor'], { stdio: ['pipe', 'pipe', 'inherit'] });
const rl = createInterface({ input: srv.stdout });
const waiting = new Map(); let nid = 1;
rl.on('line', l => { const m = JSON.parse(l); waiting.get(m.id)?.(m); waiting.delete(m.id); });
const rpc = (method, params) => new Promise(res => { const id = nid++; waiting.set(id, res); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const raw = (name, args) => rpc('tools/call', { name, arguments: args });
const tool = async (name, args) => JSON.parse((await raw(name, args)).result.content.find(c => c.type === 'text').text);
const ex = (command, params) => tool('execute', { command, params });
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const near = (a, b, rel) => Math.abs(a - b) <= Math.max(Math.abs(b) * rel, 1e-6);
const PI = Math.PI;

try {
  await rpc('initialize', { protocolVersion: '2025-06-18' });
  await ex('scene.new', {});

  // ── Flächen ──
  const b = (await ex('shape.add', { type: 'box', size: [40, 30, 20] })).result;
  let r = await ex('body.faces', { id: b.id });
  const top = r.result.faces.find(f => f.name === 'top');
  ok(r.ok && r.result.faces.length === 6 && top && near(top.area_mm2, 1200, 1e-6) && String(top.center) === '0,0,20', `Quader: 6 Flächen, top ${top?.area_mm2} mm² bei ${top?.center}`);
  r = await ex('sketch.extrude', { face: { id: b.id, face: 'top' }, outer: { circle: { center: [10, 0], r: 5 } }, height: 5, op: 'cut' });
  let teil = r.result.created[0];
  ok(r.ok && near(teil.volume_mm3, 24000 - 25 * PI * 5, 0.003), `Tasche auf der Oberseite: ${teil.volume_mm3} ≈ ${(24000 - 125 * PI).toFixed(1)}`);
  r = await ex('measure.section', { id: teil.id, axis: 'Z', at: 17 });
  ok(r.ok && r.result.contours === 2 && near(r.result.area_mm2, 1200 - 25 * PI, 0.003), `Schnitt Z=17: 2 Konturen, ${r.result?.area_mm2} mm²`);
  r = await ex('measure.section', { id: teil.id, axis: 'X', at: 10 });
  ok(r.ok && near(r.result.area_mm2, 30 * 20 - 10 * 5, 0.003), `Schnitt X=10 durch die Tasche: ${r.result?.area_mm2} ≈ 550 (Tasche bei x=+10)`);
  r = await ex('sketch.extrude', { face: { id: teil.id, face: '+x' }, outer: { rect: { size: [10, 8] } }, height: 6, op: 'join' });
  teil = r.result.created[0];
  ok(r.ok && near(teil.bbox.max[0], 26, 1e-3) && near(teil.volume_mm3, 24000 - 125 * PI + 480, 0.003), `Zapfen auf +x: bis x=${teil.bbox.max[0]}, Vol ${teil.volume_mm3}`);
  r = await ex('sketch.extrude', { face: { id: teil.id, face: [0, -15, 10] }, outer: { rect: { size: [6, 6] } }, height: 2, op: 'cut' });
  ok(r.ok && near(r.result.created[0].volume_mm3, teil.volume_mm3 - 72, 0.003), 'Fläche per Punkt (Vorderseite), Tasche 6×6×2');
  r = await ex('sketch.extrude', { face: { id: r.result.created[0].id, face: 'gibtsnicht' }, outer: { rect: { size: [6, 6] } }, height: 2 });
  ok(!r.ok && /body.faces/.test(r.error), 'unbekannte Fläche → Meldung');

  // ── Skizze mit Bedingungen ──
  await ex('scene.new', {});
  await ex('param.set', { name: 'breite', value: 50 });
  const sk = {
    entities: [
      { id: 'l1', type: 'line', a: [0, 0], b: [48, 2] }, { id: 'l2', type: 'line', a: [48, 2], b: [47, 33] },
      { id: 'l3', type: 'line', a: [47, 33], b: [1, 29] }, { id: 'l4', type: 'line', a: [1, 29], b: [0, 0] },
      { id: 'c1', type: 'circle', c: [20, 12], r: 4 },
    ],
    constraints: [
      { type: 'fix', refs: ['l1.a'] }, { type: 'horizontal', refs: ['l1'] }, { type: 'horizontal', refs: ['l3'] },
      { type: 'vertical', refs: ['l2'] }, { type: 'vertical', refs: ['l4'] },
      { type: 'length', refs: ['l1'], value: 'breite' }, { type: 'length', refs: ['l2'], value: 30 },
      { type: 'radius', refs: ['c1'], value: 5 }, { type: 'distance', refs: ['c1.c', 'l1'], value: 15 }, { type: 'distance', refs: ['c1.c', 'l4'], value: 'breite/2' },
    ],
  };
  r = await ex('sketch.solve', { sketch: sk });
  ok(r.ok && r.result.ok && r.result.dof === 0 && String(r.result.entities.l1.b) === '50,0' && String(r.result.entities.c1.c) === '25,15' && r.result.closed_loops === 2,
     `sketch.solve: dof ${r.result?.dof}, l1.b ${r.result?.entities?.l1?.b}, Kreismitte ${r.result?.entities?.c1?.c}`);
  r = await ex('sketch.extrude', { sketch: sk, height: 4 });
  ok(r.ok && near(r.result.volume_mm3, (1500 - 25 * PI) * 4, 0.003) && near(r.result.bbox.max[0], 50, 1e-3), `Skizze mit Bedingungen gebaut: ${r.result?.volume_mm3} ≈ ${((1500 - 25 * PI) * 4).toFixed(1)}`);
  r = await ex('param.set', { name: 'breite', value: 70 });
  ok(r.ok && near(r.result.bodies[0].size[0], 70, 1e-3) && near(r.result.volume_after, (2100 - 25 * PI) * 4, 0.003), `breite=70 → Skizze neu gelöst: ${r.result?.bodies?.[0]?.size}`);
  const unter = await ex('sketch.solve', { sketch: { entities: sk.entities.slice(0, 4), constraints: sk.constraints.slice(1, 5) } });
  ok(unter.ok && unter.result.dof > 0, `unterbestimmte Skizze meldet dof ${unter.result?.dof}`);

  // ── Messen ──
  await ex('scene.new', {});
  const A = (await ex('shape.add', { type: 'box', size: [10, 10, 10], center: [0, 0, 5] })).result;
  const B = (await ex('shape.add', { type: 'sphere', size: [10, 10, 10], center: [20, 0, 5] })).result;
  r = await tool('measure', { a: A.id, b: B.id });
  ok(r.ok && near(r.result.min_distance_mm, 10, 0.01), `kleinster Abstand Quader–Kugel: ${r.result?.min_distance_mm} ≈ 10`);
  await ex('body.transform', { id: B.id, center: [8, 0, 5] });
  r = await ex('measure.interference', {});
  ok(r.ok && r.result.collisions.length === 1 && r.result.collisions[0].overlap_mm3 > 50, `Kollision erkannt: ${JSON.stringify(r.result?.collisions)}`);

  // ── Kamera, Schnittansicht, kompakt ──
  const s = (await ex('shape.add', { type: 'box', size: [40, 30, 20], center: [0, 40, 10] })).result;
  await ex('body.shell', { id: s.id, thickness: 2 });
  const im = await raw('screenshot', { camera: { target: [0, 40, 10], yaw: 30, pitch: 25, distance: 120 }, section: { axis: 'X', at: 0 }, width: 480, height: 320, path: 'schnitt.png' });
  ok(!im.result.isError && im.result.content[0].type === 'image', 'Screenshot mit freier Kamera + Schnitt');
  const ortho = await raw('screenshot', { camera: { target: [0, 0, 0], yaw: 0, pitch: 90, distance: 150, fov: 0 }, width: 320, height: 240 });
  ok(!ortho.result.isError, 'orthografische Draufsicht');
  const beides = await raw('screenshot', { view: 'iso', camera: { distance: 10 } });
  ok(beides.result.isError, 'view + camera zugleich → Fehler');
  const kurz = await tool('execute', { command: 'scene.inspect', params: { measure: true }, verbose: false });
  ok(kurz.ok && kurz.result.bodies.every(o => !o.bbox && o.size), 'verbose:false → kompakte Körper');
  const lang = JSON.stringify(await tool('execute', { command: 'scene.inspect', params: { measure: true } })).length;
  ok(JSON.stringify(kurz).length < lang * 0.7, `kompakt ${JSON.stringify(kurz).length} statt ${lang} Zeichen`);
} catch (e) { console.error(e); fail++; }
finally { srv.stdin.end(); setTimeout(() => process.exit(fail ? 1 : 0), 1500); }
console.log(fail ? `\n${fail} FEHLER` : '\nALLES OK');
