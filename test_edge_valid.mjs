// 150 zufällige Fasen/Rundungs-Kombinationen am Würfel: kein Ergebnis darf undicht sein (UNDICHT 0)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8859;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore', cwd: '/home/v3da' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl'] });
const pg = await b.newPage();
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function');
  console.log(await pg.evaluate(async () => {
    const oc = await _loadOCCT(); const out = [];
    out.push('Analyzer: ' + typeof oc.BRepCheck_Analyzer + ' GProp: ' + typeof oc.GProp_GProps_1 + ' ' + typeof (oc.BRepGProp && oc.BRepGProp.VolumeProperties_1));
    const EP = EDGE_ENDPOINTS.map(ep => [ep[0].map(v => v+1), ep[1].map(v => v+1)]);
    const closed = geo => { const pos = geo.attributes.position, idx = geo.index; const k = i => Math.round(pos.getX(i)*1e4)+','+Math.round(pos.getY(i)*1e4)+','+Math.round(pos.getZ(i)*1e4);
      const E = new Map(); for (let t = 0; t < idx.count; t += 3) { const K = [k(idx.getX(t)), k(idx.getX(t+1)), k(idx.getX(t+2))];
        for (let j = 0; j < 3; j++) { const e = [K[j], K[(j+1)%3]].sort().join('|'); E.set(e, (E.get(e)||0)+1); } }
      let open = 0; E.forEach(n => { if (n !== 2) open++; }); return open; };
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let bad = 0, okN = 0, failN = 0; const badCases = [];
    for (let trial = 0; trial < 150; trial++) {
      const n = 2 + Math.floor(rnd() * 3); const ops = []; const used = new Set();
      while (ops.length < n) { const i = Math.floor(rnd() * 12); if (used.has(i)) continue; used.add(i);
        ops.push({ idx: i, type: rnd() < 0.5 ? 'chamfer' : 'fillet', dist: +(0.1 + rnd() * 0.8).toFixed(2), wa: EP[i][0], wb: EP[i][1] }); }
      let r; try { const base = _buildOCCTBaseShape(oc, 'box', 1, 1, 1, null, 0, false, null);
        r = _replayOCCTOps(oc, base, JSON.parse(JSON.stringify(ops)), 1, 1, 1); } catch (e) { failN++; continue; }
      if (!r.opOk) { failN++; continue; }
      const geo = _occtShapeToThreeGeo(oc, r.shape, { x: 0, y: 0, z: 0 });
      const open = closed(geo);
      let valid = null; try { const an = new oc.BRepCheck_Analyzer(r.shape, true); valid = an.IsValid_2 ? an.IsValid_2() : an.IsValid_1 ? an.IsValid_1() : an.IsValid(); an.delete(); } catch (e) { valid = 'n/a:' + e.message.slice(0,40); }
      if (open) { bad++; if (badCases.length < 5) badCases.push({ ops: ops.map(o => o.idx + o.type[0] + o.dist), open, valid }); } else okN++;
      if (!open && valid === false) out.push('valid=false aber dicht: ' + JSON.stringify(ops.map(o => o.idx + o.type[0] + o.dist)));
    }
    out.push(`ok ${okN}, fail ${failN}, UNDICHT ${bad}`); out.push(JSON.stringify(badCases, null, 0));
    return out.join('\n');
  }));
} finally { await b.close(); srv.kill(); }
