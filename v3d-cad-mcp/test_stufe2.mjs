// Stufe 2 über das MCP-Protokoll: Skizzen, Runden/Fasen, Generatoren.
// Sollwerte von Hand gerechnet (Formeln in den Kommentaren).
import { spawn } from 'child_process';
import { createInterface } from 'readline';

const srv = spawn('node', [new URL('./server.mjs', import.meta.url).pathname, '--no-monitor'], { stdio: ['pipe', 'pipe', 'inherit'] });
const rl = createInterface({ input: srv.stdout });
const waiting = new Map(); let nid = 1;
rl.on('line', l => { const m = JSON.parse(l); waiting.get(m.id)?.(m); waiting.delete(m.id); });
const rpc = (method, params) => new Promise(res => { const id = nid++; waiting.set(id, res); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const ex = async (command, params) => {
  const r = await rpc('tools/call', { name: 'execute', arguments: { command, params } });
  return JSON.parse(r.result.content[0].text);
};
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const near = (a, b, rel) => Math.abs(a - b) <= Math.abs(b) * rel;
const PI = Math.PI;

try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18' });
  ok(/anleitung/.test(init.result.instructions) && init.result.capabilities.resources, 'Instructions verweisen auf die Anleitung');
  const an = await rpc('tools/call', { name: 'anleitung', arguments: {} });
  ok(/Rezepte/.test(an.result.content[0].text), 'Werkzeug anleitung liefert die Anleitung');
  const rs = await rpc('resources/read', { uri: 'v3d-cad://anleitung' });
  ok(/Box mit Deckel/.test(rs.result.contents[0].text), 'Ressource v3d-cad://anleitung');
  await ex('scene.new', {});

  // ── Runden/Fasen ──
  // Würfel a=20, alle Kanten r=2: (a−2r)³ + 6(a−2r)²r + 3π r²(a−2r) + 4/3 π r³
  let b = (await ex('shape.add', { type: 'box', size: [20, 20, 20] })).result;
  const e = await ex('body.edges', { id: b.id });
  ok(e.ok && e.result.edges.length === 12, 'Würfel hat 12 Kanten');
  let f = await ex('body.fillet', { id: b.id, radius: 2 });
  const vRund = 16 ** 3 + 6 * 256 * 2 + 3 * PI * 4 * 16 + 4 / 3 * PI * 8;
  ok(f.ok && near(f.result.volume_mm3, vRund, 0.01) && f.result.id === b.id, `Würfel rund r=2: ${f.result?.volume_mm3} ≈ ${vRund.toFixed(1)} (id bleibt ${b.id})`);
  f = await ex('body.fillet', { id: b.id, radius: 4 });
  const vRund4 = 12 ** 3 + 6 * 144 * 4 + 3 * PI * 16 * 12 + 4 / 3 * PI * 64;
  ok(f.ok && near(f.result.volume_mm3, vRund4, 0.01), `Radius nachträglich auf 4: ${f.result?.volume_mm3} ≈ ${vRund4.toFixed(1)}`);

  // Fase oben, 2 mm, Würfel 20: 8000 − 4·(c²/2)·20 + 4·c³/3 (Eck-Überlappung)
  b = (await ex('shape.add', { type: 'box', size: [20, 20, 20], center: [40, 0, 10] })).result;
  f = await ex('body.chamfer', { id: b.id, distance: 2, edges: 'top' });
  const vFase = 8000 - 4 * 2 * 20 + 4 * 8 / 3;
  ok(f.ok && f.result.edges_changed === 4 && near(f.result.volume_mm3, vFase, 0.005), `Fase oben 2 mm: ${f.result?.volume_mm3} ≈ ${vFase.toFixed(1)}`);

  // Zylinder Ø20×20, obere Kante r=2: π·R²·h − 2π·(R − x̄)·r²(1−π/4), x̄ = r(10−3π)/(3(4−π))
  const c = (await ex('shape.add', { type: 'cylinder', size: [20, 20, 20], center: [-40, 0, 10] })).result;
  f = await ex('body.fillet', { id: c.id, radius: 2, edges: 'top' });
  const xq = 2 * (10 - 3 * PI) / (3 * (4 - PI)), vZyl = PI * 100 * 20 - 2 * PI * (10 - xq) * 4 * (1 - PI / 4);
  ok(f.ok && near(f.result.volume_mm3, vZyl, 0.01), `Zylinder oben rund: ${f.result?.volume_mm3} ≈ ${vZyl.toFixed(1)}`);

  // Kante per Punkt wählen: eine senkrechte Kante des Quaders bei (+10, +10)
  b = (await ex('shape.add', { type: 'box', size: [20, 20, 20], center: [0, 40, 10] })).result;
  f = await ex('body.fillet', { id: b.id, radius: 3, edges: [[10, 50, 10]] });
  const vEine = 8000 - 9 * (1 - PI / 4) * 20;
  ok(f.ok && f.result.edges_changed === 1 && near(f.result.volume_mm3, vEine, 0.005), `eine Kante per Punkt: ${f.result?.volume_mm3} ≈ ${vEine.toFixed(1)}`);

  // Grenzen: gedreht, Bool-Ergebnis, zu großer Radius
  const g = (await ex('shape.add', { type: 'box', size: [10, 10, 10], rotation: [0, 0, 30], center: [0, -40, 5] })).result;
  f = await ex('body.fillet', { id: g.id, radius: 1 });
  ok(!f.ok && /gedreht/.test(f.error), 'gedreht → klare Meldung: ' + f.error);
  f = await ex('body.fillet', { id: c.id, radius: 30 });
  ok(!f.ok && f.unchanged, 'zu großer Radius → Fehler, unverändert: ' + f.error);

  // ── Skizzen ──
  await ex('scene.new', {});
  // Rechteck 40×20 mit Loch r=5, 10 hoch: (800 − 25π)·10
  let s = await ex('sketch.extrude', { outer: { rect: { size: [40, 20] } }, holes: [{ circle: { r: 5 } }], height: 10 });
  ok(s.ok && near(s.result.volume_mm3, (800 - 25 * PI) * 10, 0.002) && String(s.result.size) === '40,20,10', `Skizze Rechteck mit Loch: ${s.result?.volume_mm3} / ${s.result?.size}`);
  // abgerundetes Rechteck r=3: (800 − (4−π)·9)·10
  s = await ex('sketch.extrude', { outer: { rect: { center: [0, 40], size: [40, 20], corner_radius: 3 } }, height: 10 });
  ok(s.ok && near(s.result.volume_mm3, (800 - (4 - PI) * 9) * 10, 0.003), `abgerundetes Rechteck: ${s.result?.volume_mm3}`);
  // Vorderansicht (XZ): 20 breit, 10 hoch, 5 tief nach −Y
  s = await ex('sketch.extrude', { outer: { rect: { center: [60, 5], size: [20, 10] } }, height: 5, plane: 'XZ' });
  ok(s.ok && String(s.result.size) === '20,5,10' && near(s.result.bbox.min[1], -5, 1e-3) && near(s.result.bbox.min[2], 0.0001, 1), `Ebene XZ: Größe ${s.result?.size}, Y ${s.result?.bbox.min[1]}…${s.result?.bbox.max[1]}`);
  // Seitenansicht (YZ): Sechseck, 8 nach +X
  s = await ex('sketch.extrude', { outer: { ngon: { center: [0, 15], r: 10, sides: 6 } }, height: 8, plane: 'YZ', offset: -60 });
  ok(s.ok && near(s.result.size[0], 8, 1e-3) && near(s.result.bbox.min[0], -60, 1e-3) && near(s.result.volume_mm3, 1.5 * Math.sqrt(3) * 100 * 8, 0.002), `Ebene YZ Sechseck: ${s.result?.size} Vol ${s.result?.volume_mm3}`);

  // Abziehen per Skizze: Platte 40×40×10, Kreis r=5 durch
  const pl = (await ex('shape.add', { type: 'box', size: [40, 40, 10], center: [0, -60, 5] })).result;
  s = await ex('sketch.extrude', { outer: { circle: { center: [0, -60], r: 5 } }, height: 20, offset: -5, op: 'cut', target: pl.id });
  ok(s.ok && near(s.result.created[0].volume_mm3, 16000 - 25 * PI * 10, 0.003), `Skizze cut: ${s.result?.created?.[0]?.volume_mm3} ≈ ${(16000 - 250 * PI).toFixed(1)}`);
  // Anfügen: Zapfen oben drauf
  s = await ex('sketch.extrude', { outer: { circle: { center: [10, -60], r: 3 } }, height: 5, offset: 10, op: 'join', target: s.result.created[0].id });
  ok(s.ok && near(s.result.created[0].volume_mm3, 16000 - 250 * PI + 45 * PI, 0.003), `Skizze join: ${s.result?.created?.[0]?.volume_mm3}`);
  // Kante oben gerundet
  s = await ex('sketch.extrude', { outer: { rect: { center: [-60, 0], size: [20, 20] } }, height: 10, fillet_top: 2 });
  ok(s.ok && s.result.volume_mm3 < 4000 && s.result.volume_mm3 > 3900, `Skizze fillet_top: ${s.result?.volume_mm3}`);
  s = await ex('sketch.extrude', { outer: { polygon: [[0, 0], [10, 0]] }, height: 5 });
  ok(!s.ok && /mindestens 3/.test(s.error), 'kaputte Kontur → Meldung: ' + s.error);

  // ── Drehen: Bool-Ergebnis umdrehen (Deckel-Rezept) ──
  await ex('scene.new', {});
  const dk = (await ex('sketch.extrude', { outer: { rect: { size: [80, 50], corner_radius: 3 } }, height: 2 })).result;
  const dj = await ex('sketch.extrude', { outer: { rect: { size: [75, 45] } }, height: 3, offset: 2, op: 'join', target: dk.id });
  const did = dj.result.created[0].id;
  let rt = await ex('body.transform', { id: did, rotation: [180, 0, 0] });
  ok(!rt.ok && /rotate/.test(rt.error), 'absolut drehen bei Bool-Ergebnis → Hinweis auf rotate');
  rt = await ex('body.transform', { id: did, rotate: [180, 0, 0], drop: true });
  ok(rt.ok && String(rt.result.size) === '80,50,5' && Math.abs(rt.result.bbox.min[2]) < 1e-3, 'Deckel mit rotate umgedreht: ' + rt.result?.size);
  rt = await ex('body.transform', { id: did, rotate: [0, 0, 90] });
  ok(rt.ok && String(rt.result.size) === '50,80,5', 'rotate um Z 90°: ' + rt.result?.size);

  // ── Generatoren ──
  await ex('scene.new', {});
  const gl = await ex('gen.list', {});
  ok(gl.ok && gl.result.generators.length >= 10, 'gen.list: ' + gl.result.generators.map(x => x.id).join(', '));
  const gb = await ex('gen.list', { id: 'becher' });
  ok(gb.ok && gb.result.params.some(x => x.k === 'hoehe' && x.min === 40), 'Becher-Parameter: ' + gb.result.params.map(x => x.k).join(', '));
  let gr = await ex('gen.run', { id: 'becher', vorlage: 'tasse', params: { hoehe: 80, name: 'Emma' } });
  ok(gr.ok && gr.result.created.length >= 1, 'Tasse gebaut: ' + gr.result?.created?.map(t => t.name + ' ' + t.size).join(' | '));
  const zMin = Math.min(...gr.result.created.map(t => t.bbox.min[2]));
  const hoehe = Math.max(...gr.result.created.map(t => t.bbox.max[2])) - zMin;
  ok(Math.abs(zMin) < 0.01 && Math.abs(hoehe - 80) < 3, `steht auf der Platte, Höhe ${hoehe.toFixed(1)} ≈ 80`);
  const ge = await ex('gen.edit', { id: gr.result.created[0].id, params: { hoehe: 120 } });
  const h2 = Math.max(...ge.result.created.map(t => t.bbox.max[2])) - Math.min(...ge.result.created.map(t => t.bbox.min[2]));
  const nachher = (await ex('scene.inspect', {})).result.bodies.length;
  ok(ge.ok && Math.abs(h2 - 120) < 3 && nachher === ge.result.created.length, `gen.edit Höhe 120: ${h2.toFixed(1)}, Körper in der Szene ${nachher}`);
  const gx = await ex('gen.run', { id: 'becher', params: { hoehe: 999 } });
  ok(!gx.ok && /zwischen 40 und 160/.test(gx.error), 'Bereichsprüfung: ' + gx.error);
  const gy = await ex('gen.run', { id: 'becher', params: { form: 'dreieck' } });
  ok(!gy.ok && /erlaubt/.test(gy.error), 'Auswahlprüfung: ' + gy.error);
  for (const id of gl.result.generators.map(x => x.id)) {
    await ex('scene.new', {});
    const r = await ex('gen.run', { id });
    ok(r.ok && r.result.created.length > 0, `Generator ${id}: ${r.ok ? r.result.created.length + ' Teile' : r.error}`);
  }
} catch (e) { console.error(e); fail++; }
finally { srv.stdin.end(); setTimeout(() => process.exit(fail ? 1 : 0), 1500); }
console.log(fail ? `\n${fail} FEHLER` : '\nALLES OK');
