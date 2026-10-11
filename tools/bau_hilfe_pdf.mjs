// Baut V3D-CAD-Hilfe.pdf aus hilfe-daten.js (gleiche Druckfassung wie „🖨 Drucken“ auf der Hilfe-Seite).
// Aufruf: node tools/bau_hilfe_pdf.mjs   — nach Änderungen an hilfe-daten.js neu bauen und committen.
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8988;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch();
try {
  const p = await b.newPage();
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _hlfLaden === 'function');
  const html = await p.evaluate(async () => { await _hlfLaden(); return _hlfDruckHtml(window.V3D_HILFE_BEREICHE, window.V3D_HILFE, VOLME3D_VERSION); });
  const q = await b.newPage();
  await q.setContent(html, { waitUntil: 'load' });
  await q.pdf({ path: '/home/v3da/V3D-CAD-Hilfe.pdf', format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '16mm', left: '15mm', right: '15mm' },
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#999">V3D CAD – Hilfe · Seite <span class="pageNumber"></span> von <span class="totalPages"></span></div>' });
  console.log('V3D-CAD-Hilfe.pdf geschrieben');
} finally { await b.close(); srv.kill(); }
