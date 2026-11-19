// Bild invertieren (Laser) _bil*: Pixel-Kern, Transparenz, Spiegeln, Raster, PNG mit DPI (pHYs),
// Generator-Liste/Rubrik/Suche, Dialog-Screenshot. Läuft gegen --dev (eigener Port).
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
const PORT = 8996, SHOTS = process.env.SHOTS || '/home/v3da/tests/shots/bild-invertieren';
mkdirSync(SHOTS, { recursive: true });
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { try { localStorage.setItem('v3d_umsteiger_hinweis', '1'); localStorage.removeItem('v3d_bil'); } catch (e) {} });
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _bilOpen === 'function' && typeof objects !== 'undefined');
  ok(await p.evaluate(() => _STARTERS.some(s => s.t === 'Bild invertieren (Laser)') && _GEN_THEMEN.some(([n, l]) => n === 'Laser & Werkstatt' && l.includes('Bild invertieren (Laser)'))), 'Generator in Liste + Rubrik „Laser & Werkstatt“');
  // Kern: reine Pixel
  const k = await p.evaluate(() => {
    const P = { ..._BIL_DEF };
    const px = (r, g, b, a, Q) => Array.from(_bilVerarbeiten(new Uint8ClampedArray([r, g, b, a]), 1, 1, { ...P, ...Q }));
    return { schwarz: px(0, 0, 0, 255), weiss: px(255, 255, 255, 255), transp: px(0, 0, 0, 0), transpAus: px(0, 0, 0, 0, { transpWeiss: false }),
      farbe: px(255, 0, 0, 255, { modus: 'farbe' }), ohne: px(40, 40, 40, 255, { invert: false }),
      sw1: px(100, 100, 100, 255, { modus: 'sw', invert: false, schwelle: 50 }), sw2: px(200, 200, 200, 255, { modus: 'sw', invert: false, schwelle: 50 }) };
  });
  ok(k.schwarz[0] === 255 && k.weiss[0] === 0, `invertiert: schwarz→${k.schwarz[0]}, weiß→${k.weiss[0]}`);
  ok(k.transp[0] === 255 && k.transp[3] === 255, `transparent bleibt weiß (${k.transp.join(',')})`);
  ok(k.transpAus[0] === 0, `ohne Häkchen wird transparenter Grund schwarz (${k.transpAus[0]})`);
  ok(k.farbe[0] === 0 && k.farbe[1] === 255 && k.farbe[2] === 255, `Farbe: Rot → Cyan (${k.farbe.slice(0, 3)})`);
  ok(k.ohne[0] === 40, `ohne Invertieren bleibt Grau 40 (${k.ohne[0]})`);
  ok(k.sw1[0] === 0 && k.sw2[0] === 255, 'Schwarz-Weiß-Schwelle 50 %');
  // Raster: 50-%-Grau → etwa halb schwarze Punkte, nur 0/255
  const r = await p.evaluate(() => { const w = 64, h = 64, s = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++){ s.set([128, 128, 128, 255], i * 4); }
    const o = _bilVerarbeiten(s, w, h, { ..._BIL_DEF, modus: 'raster', invert: false }); let sw = 0, rein = true;
    for (let i = 0; i < w * h; i++){ if (o[i * 4] === 0) sw++; else if (o[i * 4] !== 255) rein = false; } return { anteil: sw / (w * h), rein }; });
  ok(r.rein && Math.abs(r.anteil - 0.5) < 0.05, `Raster: nur Schwarz/Weiß, ${(r.anteil * 100).toFixed(1)} % schwarz bei 50-%-Grau`);
  // Testbild: links schwarz, rechts weiß, oben-rechts transparent
  await p.evaluate(async () => { hideStarter?.(); _bilOpen();
    const c = document.createElement('canvas'); c.width = 200; c.height = 100; const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, 100, 100); x.fillStyle = '#fff'; x.fillRect(100, 50, 100, 50);
    x.fillStyle = '#c33'; x.font = 'bold 40px sans-serif'; x.fillText('V3D', 110, 40);
    const bl = await new Promise(r => c.toBlob(r, 'image/png')); await _bilLaden(bl, 'test.png'); });
  ok(await p.evaluate(() => _bilP.breite === Math.round(200 / 254 * 25.4) && document.getElementById('bil-canvas').style.display === 'block'), 'Bild geladen, Startbreite aus Pixeln bei 254 DPI');
  await p.evaluate(() => { _bilSet('breite', 50); _bilSet('dpi', 254); });
  const A = await p.evaluate(() => _bilAusgabe());
  ok(A.w === 500 && A.h === 250, `Ausgabe 50 mm bei 254 DPI → ${A.w}×${A.h} px`);
  // PNG: pHYs = 10000 px/m, Pixel prüfen (links schwarz → weiß), Spiegeln
  const png = async () => p.evaluate(async () => { const bl = await _bilBlob(), u = new Uint8Array(await bl.arrayBuffer()), dv = new DataView(u.buffer);
    const typ = String.fromCharCode(...u.slice(37, 41)), ppm = dv.getUint32(41);
    const im = await createImageBitmap(bl), c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const g = (X, Y) => x.getImageData(X, Y, 1, 1).data[0];
    return { typ, ppm, w: im.width, links: g(50, 125), rechtsUnten: g(450, 200), rechtsOben: g(490, 5) }; });
  let q = await png();
  ok(q.typ === 'pHYs' && q.ppm === 10000, `PNG trägt pHYs ${q.ppm} px/m (= 254 DPI)`);
  ok(q.w === 500 && q.links === 255 && q.rechtsUnten === 0 && q.rechtsOben === 255, `PNG-Pixel: links ${q.links}, rechts unten ${q.rechtsUnten}, transparente Ecke ${q.rechtsOben}`);
  await p.evaluate(() => _bilSet('spiegeln', true));
  const sp = await p.evaluate(async () => { const bl = await _bilBlob(), im = await createImageBitmap(bl), c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const g = (X, Y) => x.getImageData(X, Y, 1, 1).data[0]; return { lu: g(50, 200), rm: g(450, 125), lo: g(10, 5) }; });
  ok(sp.lu === 0 && sp.rm === 255 && sp.lo === 255, `gespiegelt: weißer Block links unten (${sp.lu}), schwarzer rechts (${sp.rm}), Transparenz links oben (${sp.lo})`);
  await p.evaluate(() => _bilSet('spiegeln', false));
  // Dialog-Screenshot mit Foto-ähnlichem Bild
  await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const x = c.getContext('2d');
    const gr = x.createRadialGradient(300, 200, 20, 300, 200, 300); gr.addColorStop(0, '#fde'); gr.addColorStop(1, '#223'); x.fillStyle = gr; x.fillRect(0, 0, 600, 400);
    x.fillStyle = '#111'; x.font = 'bold 120px serif'; x.fillText('Laser', 140, 240);
    await _bilLaden(await new Promise(r => c.toBlob(r, 'image/png')), 'demo'); _bilSet('modus', 'raster'); });
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${SHOTS}/bil-dialog.png`, clip: await p.locator('#bil-modal .g3box').boundingBox() });
  await p.evaluate(() => _bilVorherZeigen(true)); await p.waitForTimeout(100);
  ok(await p.evaluate(() => document.getElementById('bil-tag').style.display === ''), '„Vorher“ zeigt das Original');
  await p.evaluate(() => _bilVorherZeigen(false));
  ok(errs.length === 0, 'keine Seitenfehler' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `\n${fail} FEHLER` : '\nALLES OK'); process.exit(fail ? 1 : 0);
