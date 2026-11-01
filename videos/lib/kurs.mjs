/* Gemeinsame Helfer für die Grundkurs-How-to-Videos (Untersetzer, Becher,
 * Schlüsselanhänger, Skizze). Liegt in lib/, damit make.mjs es nicht als
 * eigenes Drehbuch einliest. Stil wie uebung-a-box: Schritt-Schild oben,
 * getippte Tasten groß, Kamera per sph statt Maus-Orbit (greift sonst Objekte).
 */

/** Schritt-Schild im Stil der Folie: orange Nummer + Text (HTML erlaubt). */
export const schild = (v, nr, html, grau = false) =>
  v.eval(([nr, html, grau]) => {
    let el = document.getElementById('__vid_schild');
    if (!el) {
      el = document.createElement('div');
      el.id = '__vid_schild';
      el.style.cssText =
        'position:fixed;left:50%;top:222px;transform:translateX(-50%);z-index:2147483000;pointer-events:none;' +
        'display:flex;align-items:center;gap:22px;padding:16px 30px 16px 18px;border-radius:14px;' +
        'background:rgba(24,24,24,.94);border:1.5px solid #333;box-shadow:0 10px 30px rgba(0,0,0,.35);' +
        'font:500 27px/1.3 system-ui,Segoe UI,Arial;color:#f2f2f2;max-width:1200px;transition:opacity .3s';
      document.body.appendChild(el);
    }
    if (!html) { el.style.opacity = '0'; return; }
    el.style.opacity = '1';
    const farbe = grau ? '#6b6b6b' : '#ff6a00';
    el.innerHTML =
      (nr ? `<div style="flex:none;width:56px;height:56px;border-radius:50%;background:${farbe};color:#fff;` +
        `display:flex;align-items:center;justify-content:center;font:800 28px system-ui">${nr}</div>` : '') +
      `<div>${html}</div>`;
  }, [nr, html, grau]);

/** Getippte Tasten groß einblenden (null = ausblenden). */
export const taste = (v, txt) =>
  v.eval((t) => {
    let el = document.getElementById('__vid_key');
    if (!el) {
      el = document.createElement('div');
      el.id = '__vid_key';
      el.style.cssText =
        'position:fixed;left:50%;top:330px;transform:translateX(-50%);z-index:2147483000;' +
        'pointer-events:none;display:flex;gap:10px;transition:opacity .25s';
      document.body.appendChild(el);
    }
    if (!t) { el.style.opacity = '0'; return; }
    el.style.opacity = '1';
    el.innerHTML = t.split(' ').map((k) =>
      '<span style="font:800 30px system-ui;color:#111;background:#fff;border:2px solid #333;' +
      'border-bottom-width:5px;border-radius:10px;padding:6px 18px;min-width:30px;text-align:center;' +
      'box-shadow:0 6px 18px rgba(0,0,0,.3)">' + k + '</span>').join('');
  }, txt);

/** Kamera weich auf einen Höhenwinkel fahren. */
export const schwenk = (v, phi, theta, ms = 1500) =>
  v.eval(([phi, theta, ms]) => new Promise((res) => {
    const p0 = sph.phi, t0 = sph.theta, s = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - s) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      sph.phi = p0 + (phi - p0) * e;
      if (theta != null) sph.theta = t0 + (theta - t0) * e;
      sph2cam();
      if (k < 1) requestAnimationFrame(step); else res();
    };
    step();
  }), [phi, theta, ms]);

/** Alles ins Bild rücken, moderater Iso-Blick. */
export const blick = (v, r = 1.3) =>
  v.eval((r) => { fitView(); sph.phi = 0.9; sph.theta = 0.6; sph.r *= r; sph2cam(); }, r);

/** App startklar: Hinweise weg, leere Szene. */
export const bereit = (v) =>
  v.eval(() => {
    try { localStorage.setItem('v3d_umsteiger_hinweis', '1'); } catch (e) {}
    document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Alles klar') b.click(); });
    if (typeof hideStarter === 'function') hideStarter();
    document.getElementById('start-modal')?.classList.remove('show');
    document.getElementById('auth-overlay')?.classList.add('hidden');
    _newCreate(false); resetWorkplane(); setShapeMode('solid');
    fitView();
  });

/** Körper hinzufügen → Grundform über das echte Menü. */
export async function neueForm(v, icon) {
  await v.click('#shape-dd-btn', { after: 500 });
  await v.click(`#shape-dd .shp[data-icon="${icon}"]`, { after: 700 });
}

/** Ein Maß ins Eigenschaften-Fenster tippen (Feld-id), mit Enter. */
export async function tippFeld(v, id, wert, delay = 90) {
  await v.type(id, String(wert), { delay });
  await v.page.keyboard.press('Enter');
  await v.sleep(250);
}

/** Bildschirmpunkt auf der obersten Fläche des idx-ten Körpers (nicht projizieren). */
export const oberseite = (v, idx = 0) =>
  v.eval((idx) => {
    const o = objects[idx], b = new THREE.Box3().setFromObject(o), cv = renderer.domElement, r = cv.getBoundingClientRect();
    const q = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2).project(camera);
    const bx = r.left + (q.x * 0.5 + 0.5) * r.width, by = r.top + (-q.y * 0.5 + 0.5) * r.height;
    for (let d = 0; d <= 70; d += 3)
      for (const [ox, oy] of [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d]]) {
        const x = bx + ox, y = by + oy;
        if (document.elementFromPoint(x, y) !== cv) continue;
        const h = pickObjects({ clientX: x, clientY: y }).find((h) => h.object === o && h.face);
        if (!h) continue;
        const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
        if (n.y > 0.9 && Math.abs(h.point.y - b.max.y) < 0.02) return { x, y };
      }
    throw new Error('Oberseite nicht gefunden');
  }, idx);

/** Skizzen-Punkt (u,v in mm) → Bildschirmkoordinate über den Skizzen-Rahmen. */
export const skizzePunkt = (v, u, w) =>
  v.eval(([u, w]) => {
    const p = _skToWorld(_skWorld(u / 10, w / 10)).project(camera), cv = renderer.domElement, r = cv.getBoundingClientRect();
    return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height };
  }, [u, w]);
