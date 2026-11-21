// DNG (iPhone ProRAW) → lesbares Bild (_rawZuBild): nachgebaute DNG wie Apple
// (IFD0 = JPEG-Vorschau YCbCr, SubIFD = LinearRaw verlustfrei-JPEG), Ausrichtung 6,
// Rückfall ohne TIFF, Lithophane-Feld (#litho-file) und Bild invertieren.
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8992;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { try { localStorage.setItem('v3d_umsteiger_hinweis', '1'); } catch (e) {} });
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _rawZuBild === 'function' && typeof objects !== 'undefined');
  // DNG im Browser bauen → als Bytes zurück
  const dng = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d');
    x.fillStyle = '#e00'; x.fillRect(0, 0, 200, 300); x.fillStyle = '#00e'; x.fillRect(200, 0, 200, 300);
    const jpg = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
    const raw = new Uint8Array(5000); raw.set([0xFF, 0xD8, 0xFF, 0xC3, 0x00, 0x11]); for (let i = 6; i < raw.length; i++) raw[i] = (i * 37) & 0xFF;
    const ifd = (entries, next) => { const u = new Uint8Array(2 + entries.length * 12 + 4), d = new DataView(u.buffer); d.setUint16(0, entries.length, true);
      entries.forEach(([tag, typ, val], i) => { const o = 2 + i * 12; d.setUint16(o, tag, true); d.setUint16(o + 2, typ, true); d.setUint32(o + 4, 1, true); if (typ === 3) d.setUint16(o + 8, val, true); else d.setUint32(o + 8, val, true); });
      d.setUint32(2 + entries.length * 12, next, true); return u; };
    const H = 8, IFD0 = H, n0 = 8, IFD1 = IFD0 + 2 + n0 * 12 + 4, n1 = 5, JPG = IFD1 + 2 + n1 * 12 + 4, RAW = JPG + jpg.length;
    const i0 = ifd([[254, 4, 1], [259, 3, 7], [262, 3, 6], [273, 4, JPG], [274, 3, 6], [277, 3, 3], [279, 4, jpg.length], [330, 4, IFD1]], 0);
    const i1 = ifd([[254, 4, 0], [259, 3, 7], [262, 3, 34892], [273, 4, RAW], [279, 4, raw.length]], 0);
    const out = new Uint8Array(RAW + raw.length); out.set([0x49, 0x49, 42, 0, IFD0, 0, 0, 0]); out.set(i0, IFD0); out.set(i1, IFD1); out.set(jpg, JPG); out.set(raw, RAW);
    return Array.from(out);
  });
  const r1 = await p.evaluate(async bytes => { const f = new File([new Uint8Array(bytes)], 'IMG_0042.DNG', { type: 'image/x-adobe-dng' });
    const j = await _rawZuBild(f), bm = await createImageBitmap(j), c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
    const px = (X, Y) => Array.from(x.getImageData(X, Y, 1, 1).data.slice(0, 3));
    return { name: j.name, type: j.type, w: bm.width, h: bm.height, oben: px(150, 50), unten: px(150, 350) }; }, dng);
  ok(r1.name === 'IMG_0042.jpg' && r1.type === 'image/jpeg', `DNG → ${r1.name} (${r1.type})`);
  ok(r1.w === 300 && r1.h === 400, `Ausrichtung 6 angewandt: ${r1.w}×${r1.h} (hochkant)`);
  ok(r1.oben[0] > 180 && r1.oben[2] < 80 && r1.unten[2] > 180 && r1.unten[0] < 80, `Bildinhalt richtig gedreht (oben ${r1.oben}, unten ${r1.unten})`);
  // Rückfall: kein TIFF, JPEG irgendwo in der Datei
  const r2 = await p.evaluate(async bytes => { const u = new Uint8Array(bytes), jpgAt = u.findIndex((v, i) => v === 0xFF && u[i + 1] === 0xD8 && u[i + 2] === 0xFF && u[i + 3] !== 0xC3);
    const junk = new Uint8Array(3000).fill(7), f = new File([junk, u.subarray(jpgAt)], 'kaputt.dng');
    const j = await _rawZuBild(f), bm = await createImageBitmap(j); return [bm.width, bm.height]; }, dng);
  ok(r2[0] === 400 && r2[1] === 300, `Rückfall ohne TIFF-Kopf findet das JPEG (${r2})`);
  const r3 = await p.evaluate(async () => { try { await _rawZuBild(new File([new Uint8Array(2000)], 'leer.dng')); return 'kein Fehler'; } catch (e) { return e.message; } });
  ok(/kein lesbares Vorschaubild/.test(r3), `DNG ohne Vorschau → klare Meldung („${r3}“)`);
  ok(await p.evaluate(async () => { const f = new File(['x'], 'a.png', { type: 'image/png' }); return (await _rawZuBild(f)) === f; }), 'PNG/JPG gehen unverändert durch');
  // Lithophane: Datei über das echte Feld
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} document.getElementById('umsteiger-hinweis')?.remove(); });
  ok(await p.evaluate(() => /\.dng/.test(document.getElementById('litho-file').accept)), 'Lithophane-Feld nimmt .dng an (auch „📱 Vom Handy“)');
  ok(await p.evaluate(() => _handyPasst(document.getElementById('litho-file'), { name: 'IMG_0042.DNG'.toLowerCase(), typ: '' })), 'Handy-Übernahme lässt .dng ins Lithophane-Feld');
  await p.setInputFiles('#litho-file', { name: 'IMG_0042.DNG', mimeType: 'image/x-adobe-dng', buffer: Buffer.from(dng) });
  await p.waitForFunction(() => _litho.bilder.length >= 1, null, { timeout: 15000 }).catch(() => {});
  const L = await p.evaluate(() => _litho.bilder.map(x => ({ n: x.name, a: +x.aspect.toFixed(3), w: x.img.width })));
  ok(L.length === 1 && L[0].a === 0.75 && L[0].w === 300, `Lithophane hat das DNG-Foto geladen (${JSON.stringify(L)})`);
  // Bild invertieren
  const bi = await p.evaluate(async bytes => { _bilOpen(); const ok = await _bilLaden(new Blob([new Uint8Array(bytes)], { type: 'image/x-adobe-dng' }), 'IMG_0042.DNG'); return { ok, w: _bilImg && _bilImg.naturalWidth, name: _bilName }; }, dng);
  ok(bi.ok && bi.w === 300 && bi.name === 'IMG_0042', `Bild invertieren lädt DNG (${JSON.stringify(bi)})`);
  ok(errs.length === 0, 'keine Seitenfehler' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `\n${fail} FEHLER` : '\nALLES OK'); process.exit(fail ? 1 : 0);
