// Eigenschaften-Feld (#fp) am Kopf verschieben: Klick verschiebt nichts, Ziehen bleibt im
// Arbeitsbereich (Kopf nie unter der Kopfleiste), Doppelklick = Standardlage. Bug 21.11.26.
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8993;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  for (const vp of [{ width: 1400, height: 900 }, { width: 1920, height: 1080 }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(() => { try { localStorage.setItem('v3d_umsteiger_hinweis', '1'); } catch (e) {} });
    await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
    await p.waitForFunction(() => typeof addShape === 'function' && typeof objects !== 'undefined');
    await p.evaluate(() => { try { hideStarter(); } catch (e) {} document.getElementById('umsteiger-hinweis')?.remove(); addShape('box'); });
    await p.waitForTimeout(800);
    const st = () => p.evaluate(() => { const fp = document.getElementById('fp'), r = fp.getBoundingClientRect(), h = document.getElementById('fp-hdr').getBoundingClientRect();
      const hit = document.elementFromPoint(h.left + h.width / 2, h.top + h.height / 2); return { top: Math.round(r.top), left: Math.round(r.left), frei: !!hit && !!hit.closest('#fp-hdr') }; });
    const tag = `${vp.width}×${vp.height}`;
    const s0 = await st();
    ok(s0.frei, `${tag}: Kopf anfangs greifbar (top ${s0.top})`);
    let h = await p.locator('#fp-hdr').boundingBox();
    await p.mouse.click(h.x + 40, h.y + 8); await p.waitForTimeout(300);
    const s1 = await st();
    ok(s1.frei && Math.abs(s1.top - s0.top) < 2 && Math.abs(s1.left - s0.left) < 2, `${tag}: Klick in den Kopf verschiebt nichts (${s0.top}→${s1.top})`);
    // weit nach oben links ziehen
    h = await p.locator('#fp-hdr').boundingBox();
    await p.mouse.move(h.x + 40, h.y + 8); await p.mouse.down(); await p.mouse.move(h.x - 400, h.y - 600, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(300);
    const s2 = await st();
    ok(s2.frei, `${tag}: nach Ziehen ganz nach oben ist der Kopf weiter greifbar (top ${s2.top}, left ${s2.left})`);
    // frei auf die Platte ziehen (nach rechts unten) – bleibt dort, auch nach Neuzeichnen
    h = await p.locator('#fp-hdr').boundingBox();
    await p.mouse.move(h.x + 40, h.y + 8); await p.mouse.down(); await p.mouse.move(h.x + 640, h.y + 258, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(300);
    const s3 = await st();
    await p.evaluate(() => { _fpPositionPanel(); }); await p.waitForTimeout(200);
    const s3b = await st();
    ok(s3.frei && s3.left > s2.left + 500 && s3.top > s2.top + 200 && s3b.top === s3.top && s3b.left === s3.left, `${tag}: frei verschoben nach ${s3.left}/${s3.top}, bleibt dort`);
    // zurückziehen geht
    h = await p.locator('#fp-hdr').boundingBox();
    await p.mouse.move(h.x + 40, h.y + 8); await p.mouse.down(); await p.mouse.move(h.x - 200, h.y - 100, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(200);
    const s4 = await st();
    ok(s4.frei && s4.left < s3.left - 150, `${tag}: zurückziehen klappt (${s4.left}/${s4.top})`);
    // Doppelklick → Standardlage
    h = await p.locator('#fp-hdr').boundingBox();
    await p.mouse.dblclick(h.x + 40, h.y + 8); await p.waitForTimeout(300);
    const s5 = await st();
    ok(s5.frei && Math.abs(s5.top - s0.top) < 40 && Math.abs(s5.left - s0.left) < 40, `${tag}: Doppelklick → Standardlage (${s5.left}/${s5.top})`);
    // Textur-Fenster ebenso
    const tx = await p.evaluate(async () => { toggleTexPanel(); await new Promise(r => setTimeout(r, 200)); const t = document.getElementById('tex-panel'); return t.style.display; });
    if (tx === 'block') {
      const th = await p.locator('#tex-hdr').boundingBox();
      await p.mouse.move(th.x + 30, th.y + 8); await p.mouse.down(); await p.mouse.move(th.x + 30, th.y - 800, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(200);
      const tr = await p.evaluate(() => { const h = document.getElementById('tex-hdr').getBoundingClientRect(), hit = document.elementFromPoint(h.left + 20, h.top + h.height / 2); return { top: Math.round(h.top), frei: !!hit && !!hit.closest('#tex-hdr') }; });
      ok(tr.frei, `${tag}: Textur-Fenster bleibt unter der Kopfleiste greifbar (top ${tr.top})`);
    }
    ok(errs.length === 0, `${tag}: keine Seitenfehler` + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
    await p.close();
  }
} finally { await b.close(); srv.kill(); }
console.log(fail ? `\n${fail} FEHLER` : '\nALLES OK'); process.exit(fail ? 1 : 0);
