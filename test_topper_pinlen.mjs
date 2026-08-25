// Test: neue „Pin-Länge"/„Steg-Länge"-Eigenschaft für Topper-Teile (Wunsch Ralf).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8763;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1000);

const res = await page.evaluate(async () => {
  const out = {};
  if (typeof fpApplyTtLen !== 'function') return { err: 'fpApplyTtLen fehlt' };
  const set = (id, v) => { const e = document.getElementById(id); if ('checked' in e && typeof v === 'boolean') e.checked = v; else e.value = v; };
  set('tt-text', 'HI HO'); set('tt-font', 'baloo_local'); set('tt-text2', '');
  set('tt-pins', 2); set('tt-explode', false); set('tt-dheart', false);
  const n0 = objects.length;
  _ttCreate();
  for (let i = 0; i < 100 && objects.length === n0; i++) await new Promise(r => setTimeout(r, 100));
  const top = objects[objects.length - 1];
  selectObjs([top]); ungroupSelected();

  const box = (o) => { const b = getMeshBox(o); return {
    w: +(b.getSize(new THREE.Vector3()).x*10).toFixed(1),
    h: +(b.getSize(new THREE.Vector3()).y*10).toFixed(1),
    zmin: +(b.min.z*10).toFixed(1), zmax: +(b.max.z*10).toFixed(1),
    d: +((b.max.z-b.min.z)*10).toFixed(1) }; };

  // ── Pin: Panel-Zeile vorhanden? Länge +30 → wächst an der Spitze ──
  const pin = objects.find(o => /^Pin /.test(o.userData.name || ''));
  if (!pin) return { err: 'kein Pin' };
  selectObjs([pin]);
  out.pinRowShown = !!document.getElementById('fp-ttlen');
  out.pinRowVal = out.pinRowShown ? document.getElementById('fp-ttlen').value : null;
  const letters = objects.find(o => !/^(Pin|Steg) /.test(o.userData.name || ''));
  const lb = letters ? getMeshBox(letters) : null;
  const p0 = box(pin);
  const len0 = _ttPartLenInfo(pin).lenMM;
  fpApplyTtLen(len0 + 30);
  const p1 = box(pin);
  const len1 = _ttPartLenInfo(pin).lenMM;
  // Der Ansatz liegt am Schriftzug (kleines z? — Schriftzug-BBox vergleichen), die Spitze wandert.
  const textSide = lb ? (Math.abs(p0.zmin - lb.min.z*10) < Math.abs(p0.zmax - lb.max.z*10) ? 'zmin' : 'zmax') : '?';
  out.pin = { before: p0, after: p1, len0: +len0.toFixed(1), len1: +len1.toFixed(1),
    grew30: Math.abs(len1 - len0 - 30) < 0.5,
    widthKept: Math.abs(p1.w - p0.w) < 0.1 && Math.abs(p1.h - p0.h) < 0.1,
    zminMoved: +(p1.zmin - p0.zmin).toFixed(1), zmaxMoved: +(p1.zmax - p0.zmax).toFixed(1),
    textSide };

  // ── Steg (falls vorhanden): symmetrisch aus der Mitte ──
  const steg = objects.find(o => /^Steg /.test(o.userData.name || ''));
  if (steg) {
    selectObjs([steg]);
    out.stegRowShown = !!document.getElementById('fp-ttlen');
    const s0 = box(steg);
    const sl0 = _ttPartLenInfo(steg).lenMM;
    fpApplyTtLen(sl0 + 10);
    const sl1 = _ttPartLenInfo(steg).lenMM;
    out.steg = { grew10: Math.abs(sl1 - sl0 - 10) < 0.5, before: s0, after: box(steg) };
  } else out.steg = 'kein Steg im Design';

  // ── Buchstaben-Teil: KEINE Länge-Zeile ──
  if (letters) { selectObjs([letters]); out.letterRowAbsent = !document.getElementById('fp-ttlen'); }

  // ── Undo funktioniert noch? ──
  out.undoOk = (typeof undo === 'function') ? (undo(), true) : 'kein undo()';
  return out;
});

console.log(JSON.stringify(res, null, 2));
console.log('pageErrors:', errs.length, errs.slice(0, 3));
await browser.close();
srv.kill();
