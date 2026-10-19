// Prüft 🎨 Chroma (Bild → Filament-Gemälde) und 🎬 Render-Studio headless:
// Chroma: Optimierung schlägt gleichmäßige Wechsel, Netz wasserdicht, Höhe = Plan,
// Speichern/Laden behält Plan + Farben, 3MF enthält custom_gcode_per_layer.xml.
// Render-Studio: Foto, Ansichten-ZIP, 360°-Video und Kamerafahrt (Dauer per ffprobe).
// Aufruf: node tests/chroma_render_test.mjs   (Dateien landen in /tmp/chroma_test/)
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
const PORT = 8947, OUT = '/tmp/chroma_test';
fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('python3', ['/home/v3da/volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'inherit' });
await new Promise(r => setTimeout(r, 1500));
const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await br.newPage({ viewport: { width: 1500, height: 950 } });
const fehler = [];
pg.on('pageerror', e => fehler.push(String(e)));
pg.on('console', m => { if (m.type() === 'error') fehler.push(m.text()); });
let ok = true; const check = (c, t) => { console.log((c ? '✓ ' : '✗ ') + t); if (!c) ok = false; };
try {
  await pg.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await pg.waitForFunction(() => typeof _chrOpen === 'function' && typeof hideStarter === 'function', null, { timeout: 30000 });
  await pg.evaluate(() => hideStarter());

  // ── Chroma ──
  const r = await pg.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 400; const x = c.getContext('2d');
    const sky = x.createLinearGradient(0, 0, 0, 260); sky.addColorStop(0, '#0b1d4a'); sky.addColorStop(1, '#f39c4a');
    x.fillStyle = sky; x.fillRect(0, 0, 600, 260);
    const sun = x.createRadialGradient(420, 170, 5, 420, 170, 70); sun.addColorStop(0, '#fffbe0'); sun.addColorStop(1, 'rgba(255,220,120,0)');
    x.fillStyle = sun; x.fillRect(300, 60, 240, 220);
    x.fillStyle = '#1a2a1a'; x.beginPath(); x.moveTo(0, 400); x.lineTo(0, 250); x.lineTo(150, 190); x.lineTo(300, 260); x.lineTo(460, 210); x.lineTo(600, 270); x.lineTo(600, 400); x.fill();
    x.fillStyle = '#ffffff'; x.font = 'bold 56px Arial'; x.fillText('V3D', 40, 360);
    const img = new Image(); await new Promise(res => { img.onload = res; img.src = c.toDataURL('image/png'); });
    _chrOpen();
    _chr.img = img; _chr.aspect = 1.5; _chr.p.res = 240; _chrSample(); _chrAutoFarben(4); _chrNeu(true);
    const out = { fil: _chr.fil.map(f => f.hex + '/' + f.td), swaps: _chr.swaps.slice(), M: _chrM() };
    // Vergleich: gleichmäßig verteilte Wechsel
    const K = _chr.fil.length, M = _chrM(), even = []; for (let k = 1; k < K; k++) even.push(Math.round(k * M / K));
    out.errOpt = _chrErr(_chrTable(_chr.swaps)); out.errEven = _chrErr(_chrTable(even));
    // mittlerer ΔE Vorschau ↔ Bild
    let s = 0; const N = _chr.cols * _chr.rows, T = _chr.tab.lab;
    for (let i = 0; i < N; i++) { const j = _chr.jmap[i]; s += Math.hypot(_chr.lab[i*3]-T[j*3], _chr.lab[i*3+1]-T[j*3+1], _chr.lab[i*3+2]-T[j*3+2]); }
    out.dE = s / N;
    out.info = document.getElementById('chr-info').innerText;
    return out;
  });
  console.log('Filamente', r.fil.join(' '), '| Wechsel', r.swaps.join(','), 'von M =', r.M);
  console.log('Fehler optimiert', Math.round(r.errOpt), 'gleichmäßig', Math.round(r.errEven), '| mittl. ΔE', r.dE.toFixed(1));
  check(r.swaps.every((v, i) => i === 0 || v > r.swaps[i - 1]) && r.swaps[0] >= 1 && r.swaps.at(-1) <= r.M, 'Wechsel streng steigend im Bereich');
  check(r.errOpt <= r.errEven, 'Optimierung mindestens so gut wie gleichmäßige Wechsel');
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: OUT + '/chroma_dialog.png' });

  const m = await pg.evaluate(async () => {
    _chrCreate();
    const o = objects[objects.length - 1], g = o.geometry;
    const pos = g.attributes.position, idx = g.index.array, E = new Map();
    const key = v => [pos.getX(v), pos.getY(v), pos.getZ(v)].map(t => Math.round(t * 1e5)).join(',');
    for (let i = 0; i < idx.length; i += 3) for (let e = 0; e < 3; e++) {
      const a = key(idx[i + e]), b = key(idx[i + (e + 1) % 3]); const k = a < b ? a + '|' + b : b + '|' + a; E.set(k, (E.get(k) || 0) + 1);
    }
    let bad = 0; for (const v of E.values()) if (v !== 2) bad++;
    o.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(o);
    const d = objectToData(o), json = JSON.parse(JSON.stringify(d)), o2 = buildObjectFromData(json);
    const r3 = _build3mfBlob([o]);
    const u8 = new Uint8Array(await r3.blob.arrayBuffer()), z = fflate.unzipSync(u8);
    const gc = z['Metadata/layer_config_ranges.xml'] ? fflate.strFromU8(z['Metadata/layer_config_ranges.xml']) : null;
    const cfg = fflate.strFromU8(z['Metadata/model_settings.config']);
    // Von-Hand-Variante
    o.userData.chroma.modus = 'hand'; const rh = _build3mfBlob([o]); const zh = fflate.unzipSync(new Uint8Array(await rh.blob.arrayBuffer()));
    const gch = fflate.strFromU8(zh['Metadata/custom_gcode_per_layer.xml']); o.userData.chroma.modus = 'ams';
    // skaliert → kein Eintrag
    o.scale.y = 1.5; o.updateMatrixWorld(true); const rs = _build3mfBlob([o]); o.scale.y = 1; o.updateMatrixWorld(true);
    const zs = fflate.unzipSync(new Uint8Array(await rs.blob.arrayBuffer()));
    const hand3mf = new Uint8Array(await rh.blob.arrayBuffer()), handHinweis = rh.chroma;
    let b64 = ''; for (let i = 0; i < u8.length; i += 0x8000) b64 += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { bad, edges: E.size, vol: _geoSignedVolume(g), tris: idx.length / 3, hoehe: (bb.max.y - bb.min.y) * 10, plan: o.userData.chroma.hoehe,
      breite: (bb.max.x - bb.min.x) * 10, colors: !!g.attributes.color, reload: !!(o2.userData.chroma && o2.geometry.attributes.color && o2.material.vertexColors),
      gc, gch, cfg: cfg.match(/layer_height[^>]*/)?.[0], hinweis: r3.chroma, legend: r3.legend, skaliert: rs.chroma, skalGc: !!(zs['Metadata/custom_gcode_per_layer.xml'] || zs['Metadata/layer_config_ranges.xml']), handHinweis, b64: btoa(b64) };
  });
  console.log(`Netz: ${m.tris} Dreiecke, ${m.edges} Kanten, ${m.bad} offen, Volumen ${m.vol.toFixed(3)}`);
  check(m.bad === 0 && m.vol > 0, 'Chroma-Netz wasserdicht, Normalen außen');
  check(Math.abs(m.hoehe - m.plan) < 0.01, `Höhe ${m.hoehe.toFixed(3)} mm = Plan ${m.plan.toFixed(3)} mm`);
  check(Math.abs(m.breite - 100) < 0.01, `Breite ${m.breite.toFixed(2)} mm`);
  check(m.colors && m.reload, 'Vertex-Farben + Plan überleben Speichern/Laden');
  console.log(m.gc); console.log('Hand:', m.gch.match(/<layer[^>]*>/g)?.join(' ')); console.log('cfg:', m.cfg, '| legend', m.legend.join(' '));
  check(m.gc && (m.gc.match(/<range /g) || []).length === r.fil.length, '3MF: AMS-Höhenbereiche eingetragen');
  console.log('Hand-Hinweis:', m.handHinweis);
  check(/type="0"/.test(m.gch) && /SingleExtruder/.test(m.gch), '3MF: Hand-Wechsel (M600) eingetragen');
  check(!m.skalGc && /NICHT/.test(m.skaliert), 'skalierte Platte: kein Eintrag + Warnung');
  fs.writeFileSync(OUT + '/chroma.3mf', Buffer.from(m.b64, 'base64'));
  await pg.evaluate(() => { setView('iso'); fitView(); });
  await pg.mouse.click(700, 500);
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: OUT + '/chroma_szene.png' });

  // ── Render-Studio ──
  const f = await pg.evaluate(async () => {
    _foto.p.wz = '© Volme 3D'; _foto.p.groesse = '1080x1920'; _foto.p.fmt = 'jpg'; _foto.p.art = 'foto';
    const ob = objects[objects.length - 1], colAttr = ob.geometry.getAttribute('color'), c0 = colAttr.array[0], m0 = ob.material.color.getHex();
    _fotoOpen(); await _fotoRender();
    const foto = _foto.url, farbenZurueck = ob.geometry.getAttribute('color') === colAttr && colAttr.array[0] === c0 && ob.material.color.getHex() === m0;
    _foto.p.groesse = '1080x1080'; _foto.p.art = 'set'; await _fotoSetRender();
    const zip = _foto.zip ? Object.keys(fflate.unzipSync(new Uint8Array(await _foto.zip.blob.arrayBuffer()))) : [];
    _foto.p.art = 'video'; _foto.p.vgr = '1280x720'; _foto.p.dauer = 4;
    const t0 = performance.now(); await _fotoVideo('video'); const tv = performance.now() - t0;
    const v = _foto.vid; const vb = v ? new Uint8Array(await v.blob.arrayBuffer()) : null;
    // Kamerafahrt durch 2 Ansichten
    setView('front'); _fotoPfadAdd(); setView('iso'); _fotoPfadAdd();
    _foto.p.art = 'pfad'; await _fotoVideo('pfad');
    const pb = _foto.vid ? new Uint8Array(await _foto.vid.blob.arrayBuffer()) : null;
    const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    return { foto, farbenZurueck, zip, ext: v && v.ext, tv, vid: vb && b64(vb), pfad: pb && b64(pb), pext: _foto.vid && _foto.vid.ext, mime: _fotoVideoMime() };
  });
  fs.writeFileSync(OUT + '/foto.jpg', Buffer.from(f.foto.split(',')[1], 'base64'));
  check(f.foto.startsWith('data:image/jpeg'), 'Foto als JPG (9:16, mit Wasserzeichen)');
  check(f.farbenZurueck, 'nach dem Foto: Material- und Vertex-Farben unverändert');
  check(f.zip.length === 9, `Ansichten-ZIP: ${f.zip.join(', ')}`);
  console.log('Video-Format', f.mime, '| Renderzeit 4-s-Video', Math.round(f.tv), 'ms');
  for (const [nm, b, ext, soll] of [['360', f.vid, f.ext, 4], ['fahrt', f.pfad, f.pext, 4]]) {
    if (!b) { check(false, nm + ': kein Video'); continue; }
    const fn = `${OUT}/${nm}.${ext}`; fs.writeFileSync(fn, Buffer.from(b, 'base64'));
    const pr = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,nb_read_frames:format=duration', '-of', 'default=nw=1', fn]).toString().replace(/\n/g, ' ');
    console.log(nm, pr);
    const dur = parseFloat((pr.match(/duration=([\d.]+)/) || [])[1]), fr = parseInt((pr.match(/nb_read_frames=(\d+)/) || [])[1]);
    check(Math.abs(dur - soll) < 0.6 && fr >= soll * 30 * 0.85, `${nm}: ${dur.toFixed(2)} s, ${fr} Bilder (Soll ${soll} s / ${soll * 30})`);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '1.3', '-i', fn, '-frames:v', '1', `${OUT}/${nm}_bild.png`]);
  }
  await pg.evaluate(() => { _foto.p.art = 'video'; _fotoOpen(); });
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: OUT + '/render_studio.png' });
  check(!fehler.length, 'keine Seitenfehler' + (fehler.length ? ': ' + fehler.slice(0, 3).join(' | ') : ''));
} catch (e) { console.error(e); ok = false; }
await br.close(); srv.kill();
console.log(ok ? 'ALLES OK' : 'FEHLER');
process.exit(ok ? 0 : 1);
