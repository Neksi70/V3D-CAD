// 🕳️ Loch ziehen – geführter Weg mit echten Mausklicks (Ralf 10.10.26: fand den Loch-Weg nicht,
// hatte ⊙ Kreismuster erwischt). Box → Werkzeuge → Loch ziehen → Fläche → Kreis → nach unten ziehen.
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8974;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _holeQuickStart === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} const o = document.getElementById('auth-overlay'); if (o) o.style.display = 'none'; });
  await p.mouse.click(700, 500);
  ok(await p.evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '⊙ Kreismuster')), 'Anordnen-Knopf heißt jetzt „⊙ Kreismuster"');
  const vol = () => p.evaluate(() => { const o = objects[0]; o.updateMatrixWorld(true); const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
    const P = g.attributes.position, I = g.index ? g.index.array : null, n = I ? I.length : P.count; let v = 0; const a = new THREE.Vector3(), b2 = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < n; i += 3) { a.fromBufferAttribute(P, I ? I[i] : i); b2.fromBufferAttribute(P, I ? I[i+1] : i+1); c.fromBufferAttribute(P, I ? I[i+2] : i+2); v += a.dot(b2.clone().cross(c)) / 6; } return v * 1000; });
  // Box 40×40×20 mm mittig
  await p.evaluate(() => { _newCreate(false); resetWorkplane(); addShape('box'); const o = objects[0];
    const s = getMeshBox(o).getSize(new THREE.Vector3()); o.scale.multiply(new THREE.Vector3(4 / s.x, 2 / s.y, 4 / s.z)); o.updateMatrixWorld(true);
    o.position.set(0, 0, 0); o.updateMatrixWorld(true); o.position.y -= getMeshBox(o).min.y; o.updateMatrixWorld(true); });
  await p.waitForTimeout(300);
  const v0 = await vol();
  const scr = (x, y, z) => p.evaluate(([x, y, z]) => { const v = new THREE.Vector3(x, y, z).project(camera); const r = canvas.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; }, [x, y, z]);
  // Werkzeuge → Loch ziehen (echter Klick)
  await p.click('#tool-dd-btn'); await p.waitForTimeout(200);
  await p.click('#tool-dd-list .shp:has-text("Loch ziehen")'); await p.waitForTimeout(1200);
  const t1 = await p.textContent('#sk-hole-tip').catch(() => '');
  ok(/1\/3/.test(t1), 'Schritt 1 angezeigt: ' + t1.replace('✕', '').trim());
  // daneben klicken → bleibt bei Schritt 1
  const off = await scr(9, 0, 9); await p.mouse.click(off.x, off.y); await p.waitForTimeout(600);
  ok(/kein Körper/.test(await p.textContent('#sk-hole-tip')), 'Klick ins Leere: Hinweis, weiter Fläche wählen');
  const top = await scr(0, 2, 0);
  if (process.env.DBG) console.log(await p.evaluate(([x,y]) => { const hs = pickObjects({ clientX:x, clientY:y }); return hs.map(h => [h.object.type, h.object.name, h.object.userData && Object.keys(h.object.userData).join('/'), !!h.face, objects.some(o => o === h.object || o.getObjectById(h.object.id))]).slice(0,5); }, [top.x, top.y]));
  await p.mouse.click(top.x, top.y); await p.waitForTimeout(300);
  const st2 = await p.evaluate(() => ({ tool: _sk.tool, tip: (document.getElementById('sk-hole-tip')||{}).textContent, act: _sk.active, fp: _sk.facePick, n: objects.length }));
  if (process.env.DBG) { console.log(JSON.stringify(st2), top); await p.screenshot({ path: '/tmp/loch_dbg.png' }); }
  ok(st2.tool === 'circle' && /2\/3/.test(st2.tip), 'Fläche gewählt → Kreis-Werkzeug, Schritt 2');
  // Kreis: Mitte klicken, nach außen ziehen, loslassen (falls nur Klick-Klick: zweiter Klick)
  const c0 = await scr(0, 2, 0), c1 = await scr(0.6, 2, 0);
  await p.mouse.move(c0.x, c0.y); await p.mouse.down(); await p.mouse.move((c0.x + c1.x) / 2, (c0.y + c1.y) / 2, { steps: 4 }); await p.mouse.move(c1.x, c1.y, { steps: 4 }); await p.mouse.up();
  await p.waitForTimeout(200);
  let n = await p.evaluate(() => _sk.ents.filter(e => e.type === 'circle').length);
  const dragWorks = n === 1;
  if (!n) { await p.mouse.click(c1.x, c1.y); await p.waitForTimeout(200); n = await p.evaluate(() => _sk.ents.filter(e => e.type === 'circle').length); }
  console.log('     (Kreis per ' + (dragWorks ? 'Ziehen' : 'Klick–Klick') + ')');
  const st3 = await p.evaluate(() => ({ tool: _sk.tool, tip: document.getElementById('sk-hole-tip').textContent, r: _sk.ents[0] && _sk.ents[0].r }));
  ok(n === 1 && st3.tool === 'pull' && /3\/3/.test(st3.tip), `Kreis r=${(st3.r * 10).toFixed(1)} mm → automatisch „Ziehen", Schritt 3`);
  // In den Kreis drücken und nach unten ziehen
  await p.mouse.move(c0.x, c0.y); await p.mouse.down();
  for (let i = 1; i <= 12; i++) { await p.mouse.move(c0.x, c0.y + i * 6); await p.waitForTimeout(30); }
  const lbl = await p.evaluate(() => ({ op: _skPull.op, l: _skPull.label && _skPull.label.textContent }));
  ok(lbl.op === 'cut', 'nach unten ziehen zeigt Loch: ' + lbl.l);
  await p.mouse.up();
  await p.waitForFunction(() => objects.length === 1 && !_sk.hole, null, { timeout: 40000 }).catch(() => {});
  await p.waitForTimeout(1200);
  const v1 = await vol();
  ok(v0 - v1 > 50, `Loch geschnitten: −${(v0 - v1).toFixed(0)} mm³`);
  ok(!(await p.$('#sk-hole-tip')), 'Hinweis nach dem Loch weg');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 2).join(' | '));
  await p.screenshot({ path: '/tmp/loch_weg.png' });
} catch (e) { console.error(e); fail++; } finally { await b.close(); srv.kill(); }
console.log(fail ? `FEHLER: ${fail}` : 'alles grün'); process.exit(fail ? 1 : 0);
