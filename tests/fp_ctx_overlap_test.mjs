// Eigenschaften-Feld (#fp) darf die Schnellleiste unten links (#ctx) nicht überdecken (Volker 11.11.)
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8875;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  for (const [W, H] of [[1470, 870], [1280, 720], [1920, 1080]]) {
    const p = await b.newPage({ viewport: { width: W, height: H } });
    await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
    await p.waitForFunction(() => typeof _addImportedStl === 'function' && typeof objects !== 'undefined');
    const r = await p.evaluate(async () => { try { hideStarter(); } catch (e) {} _newCreate(false);
      const tris = [0,0,0, 10,0,0, 0,10,0,  0,0,0, 0,10,0, 0,0,10,  0,0,0, 0,0,10, 10,0,0,  10,0,0, 0,0,10, 0,10,0];
      const n = 4, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf); dv.setUint32(80, n, true);
      for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + t * 50 + 12 + k * 4, tris[t * 9 + k], true);
      _addImportedStl(buf, 't.stl', false); await new Promise(r => setTimeout(r, 400));
      selectObjs([objects[0]]); await new Promise(r => setTimeout(r, 400));
      const fb = document.getElementById('fp-body'), fp = document.getElementById('fp').getBoundingClientRect(), cx = document.getElementById('ctx').getBoundingClientRect();
      return { fpBottom: Math.round(fp.bottom), ctxTop: Math.round(cx.top), ctxSicht: document.getElementById('ctx').style.display !== 'none', ueberX: cx.right > fp.left && cx.left < fp.right,
               scroll: fb.scrollHeight > fb.clientHeight, fpShow: document.getElementById('fp').classList.contains('show') };
    });
    ok(r.fpShow && r.ctxSicht && (!r.ueberX || r.fpBottom <= r.ctxTop), `${W}×${H}: Feld endet bei ${r.fpBottom}, Leiste beginnt bei ${r.ctxTop}${r.scroll ? ' (Feld scrollt)' : ''}`);
    await p.close();
  }
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
