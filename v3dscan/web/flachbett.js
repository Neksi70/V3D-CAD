// V3D Scan – 2D-Messen auf Flachbettscans (v1.6). Läuft komplett im Browser, nichts geht an den Dienst.
// Teil liegt mit der Messfläche auf dem Glas → Bild (PNG/JPEG) laden → Kanten auf Subpixel (Iso-Linie der
// Helligkeit auf der Otsu-Schwelle) → Linie / Kreis / Punkt an eine Kante klicken → Maße dazwischen.
// Maßstab aus dem dpi der Datei („unkalibriert“), sauber erst nach Kalibrieren an einem bekannten Maß;
// der Faktor lässt sich als Scanner-Profil speichern. Export DXF/SVG 1:1 in mm, CSV, Bericht.
(function (root) {
  'use strict';

  // ── DPI aus der Datei ───────────────────────────────────────────────────────
  function dpiAus(buf) {
    const b = new Uint8Array(buf);
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {           // PNG: pHYs
      let o = 8;
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      while (o + 8 <= b.length) {
        const len = dv.getUint32(o), typ = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
        if (typ === 'pHYs' && len >= 9) {
          const ppu = dv.getUint32(o + 8), einheit = b[o + 16];
          return einheit === 1 && ppu > 0 ? ppu * 0.0254 : null;
        }
        if (typ === 'IDAT' || typ === 'IEND') break;
        o += 12 + len;
      }
      return null;
    }
    if (b[0] === 0xff && b[1] === 0xd8) {                                              // JPEG: JFIF APP0
      let o = 2;
      while (o + 4 < b.length && b[o] === 0xff) {
        const marker = b[o + 1], len = (b[o + 2] << 8) | b[o + 3];
        if (marker === 0xe0 && String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]) === 'JFIF') {
          const einheit = b[o + 11], x = (b[o + 12] << 8) | b[o + 13];
          return x > 0 ? (einheit === 1 ? x : einheit === 2 ? x * 2.54 : null) : null;
        }
        if (marker === 0xda) break;
        o += 2 + len;
      }
    }
    return null;
  }

  // ── Bild → Helligkeit, Schwelle ─────────────────────────────────────────────
  function grau(rgba, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, k = 0; i < g.length; i++, k += 4) g[i] = (0.2126 * rgba[k] + 0.7152 * rgba[k + 1] + 0.0722 * rgba[k + 2]) / 255;
    return g;
  }
  function otsu(g) {
    const H = new Float64Array(256);
    const schritt = Math.max(1, Math.floor(g.length / 400000));
    let n = 0;
    for (let i = 0; i < g.length; i += schritt) { H[Math.min(255, Math.max(0, Math.round(g[i] * 255)))]++; n++; }
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * H[t];
    let wB = 0, sumB = 0, best = 0, schwelle = 128;
    for (let t = 0; t < 256; t++) {
      wB += H[t]; if (!wB) continue;
      const wF = n - wB; if (!wF) break;
      sumB += t * H[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; schwelle = t; }
    }
    return (schwelle + 0.5) / 255;
  }

  // ── Iso-Linie (Marching Squares) im Fenster, zu Ketten verbunden ─────────────
  // Punkte liegen auf Pixelmitten-Koordinaten (Pixel i hat Mitte i + 0,5), linear interpoliert = Subpixel.
  function ketten(g, w, h, schwelle, x0, y0, x1, y1) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(w - 1, Math.ceil(x1)); y1 = Math.min(h - 1, Math.ceil(y1));
    const v = (x, y) => g[y * w + x] - schwelle;
    const pkt = new Map(), nachbarn = new Map();
    const kante = (art, x, y) => {                       // art 0: (x,y)-(x+1,y), 1: (x,y)-(x,y+1)
      const k = art + ':' + x + ':' + y;
      if (!pkt.has(k)) {
        const a = v(x, y), b = art ? v(x, y + 1) : v(x + 1, y), t = a === b ? 0.5 : a / (a - b);
        pkt.set(k, art ? [x + 0.5, y + 0.5 + t] : [x + 0.5 + t, y + 0.5]);
      }
      return k;
    };
    const verbinde = (a, b) => {
      if (!nachbarn.has(a)) nachbarn.set(a, []);
      if (!nachbarn.has(b)) nachbarn.set(b, []);
      nachbarn.get(a).push(b); nachbarn.get(b).push(a);
    };
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const a = v(x, y) < 0, b = v(x + 1, y) < 0, c = v(x + 1, y + 1) < 0, d = v(x, y + 1) < 0;
      const fall = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
      if (fall === 0 || fall === 15) continue;
      const O = () => kante(0, x, y), R = () => kante(1, x + 1, y), U = () => kante(0, x, y + 1), L = () => kante(1, x, y);
      switch (fall) {
        case 1: case 14: verbinde(L(), O()); break;
        case 2: case 13: verbinde(O(), R()); break;
        case 3: case 12: verbinde(L(), R()); break;
        case 4: case 11: verbinde(R(), U()); break;
        case 6: case 9: verbinde(O(), U()); break;
        case 7: case 8: verbinde(L(), U()); break;
        case 5: case 10: {                               // Sattel: Mittelwert entscheidet
          const m = (v(x, y) + v(x + 1, y) + v(x + 1, y + 1) + v(x, y + 1)) / 4 < 0;
          if ((fall === 5) === m) { verbinde(L(), U()); verbinde(O(), R()); } else { verbinde(L(), O()); verbinde(R(), U()); }
        }
      }
    }
    const besucht = new Set(), aus = [];
    for (const start of nachbarn.keys()) {
      if (besucht.has(start)) continue;
      // Kette in beide Richtungen ablaufen
      const lauf = (von) => { const k = [von]; besucht.add(von); let jetzt = von; for (;;) { const n = nachbarn.get(jetzt).find((q) => !besucht.has(q)); if (!n) return k; besucht.add(n); k.push(n); jetzt = n; } };
      const vor = lauf(start);
      const zurueck = [];
      let jetzt = start;
      for (;;) { const n = nachbarn.get(jetzt).find((q) => !besucht.has(q)); if (!n) break; besucht.add(n); zurueck.push(n); jetzt = n; }
      const ids = zurueck.reverse().concat(vor);
      const geschlossen = ids.length > 2 && nachbarn.get(ids[0]).includes(ids[ids.length - 1]);
      aus.push({ punkte: ids.map((k) => pkt.get(k)), geschlossen });
    }
    return aus;
  }

  // ── Einpassen ───────────────────────────────────────────────────────────────
  function linieFit(P) {
    let mx = 0, my = 0; for (const [x, y] of P) { mx += x; my += y; } mx /= P.length; my /= P.length;
    let sxx = 0, sxy = 0, syy = 0; for (const [x, y] of P) { const a = x - mx, b = y - my; sxx += a * a; sxy += a * b; syy += b * b; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), d = [Math.cos(th), Math.sin(th)], n = [-d[1], d[0]];
    let q = 0, tmin = Infinity, tmax = -Infinity;
    for (const [x, y] of P) { const r = (x - mx) * n[0] + (y - my) * n[1]; q += r * r; const t = (x - mx) * d[0] + (y - my) * d[1]; tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); }
    return { art: 'linie', p: [mx, my], d, rms: Math.sqrt(q / P.length), a: [mx + d[0] * tmin, my + d[1] * tmin], b: [mx + d[0] * tmax, my + d[1] * tmax], n: P.length };
  }
  function kreisFit(P) {
    // Kåsa (algebraisch) als Start, dann Gauß-Newton auf den geometrischen Abstand
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
    for (const [x, y] of P) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
    const n = P.length;
    const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], bb = [sxz, syz, sz];
    const lsg = loese3(A, bb);
    let cx = lsg[0] / 2, cy = lsg[1] / 2, r = Math.sqrt(Math.max(0, lsg[2] + cx * cx + cy * cy));
    for (let it = 0; it < 20; it++) {
      let J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0];
      for (const [x, y] of P) {
        const dx = x - cx, dy = y - cy, rr = Math.hypot(dx, dy) || 1e-12, e = rr - r;
        const j = [-dx / rr, -dy / rr, -1];
        for (let a = 0; a < 3; a++) { g[a] += j[a] * e; for (let c = 0; c < 3; c++) J[a][c] += j[a] * j[c]; }
      }
      const s = loese3(J, g.map((x) => -x));
      cx += s[0]; cy += s[1]; r += s[2];
      if (Math.hypot(s[0], s[1], s[2]) < 1e-9) break;
    }
    let q = 0; for (const [x, y] of P) { const e = Math.hypot(x - cx, y - cy) - r; q += e * e; }
    return { art: 'kreis', c: [cx, cy], r, rms: Math.sqrt(q / n), n };
  }
  function loese3(A, b) {
    const M = A.map((z, i) => [...z, b[i]]);
    for (let k = 0; k < 3; k++) {
      let p = k; for (let i = k + 1; i < 3; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
      [M[k], M[p]] = [M[p], M[k]];
      const d = M[k][k] || 1e-18;
      for (let i = 0; i < 3; i++) if (i !== k) { const f = M[i][k] / d; for (let c = k; c < 4; c++) M[i][c] -= f * M[k][c]; }
    }
    return [M[0][3] / (M[0][0] || 1e-18), M[1][3] / (M[1][1] || 1e-18), M[2][3] / (M[2][2] || 1e-18)];
  }
  // Robust: Punkte mit großem Rest raus (3 Runden), damit Ecken/Nachbarkanten nicht mitziehen
  function robust(fit, P, rest) {
    let e = fit(P);
    for (let k = 0; k < 3 && P.length > 6; k++) {
      const r = P.map((p) => Math.abs(rest(e, p)));
      const med = r.slice().sort((a, b) => a - b)[r.length >> 1];
      const neu = P.filter((p, i) => r[i] <= Math.max(3 * med, 0.05));
      if (neu.length === P.length || neu.length < 6) break;
      P = neu; e = fit(P);
    }
    return e;
  }
  const restLinie = (e, [x, y]) => (x - e.p[0]) * -e.d[1] + (y - e.p[1]) * e.d[0];
  const restKreis = (e, [x, y]) => Math.hypot(x - e.c[0], y - e.c[1]) - e.r;

  // Element an einer Kante: Kette, die dem Klick am nächsten kommt; Linie nur aus dem Stück um den Klick
  function elementAnKlick(g, w, h, schwelle, art, kx, ky, fenster) {
    const R = fenster || 400;
    const alle = ketten(g, w, h, schwelle, kx - R, ky - R, kx + R, ky + R);
    let best = null, bd = Infinity, bi = 0;
    for (const k of alle) k.punkte.forEach((p, i) => { const d = Math.hypot(p[0] - kx, p[1] - ky); if (d < bd) { bd = d; best = k; bi = i; } });
    if (!best || bd > Math.max(25, R * 0.1)) return null;
    if (art === 'punkt') return { art: 'punkt', p: best.punkte[bi].slice(), rms: 0, n: 1 };
    if (art === 'kreis') {
      if (best.punkte.length < 12) return null;
      return robust(kreisFit, best.punkte, restKreis);
    }
    // Linie: zusammenhängendes Stück der Kette um den Klick, solange sie gerade bleibt (Bogenlänge ≤ fenster/2)
    const pk = best.punkte, stueck = [pk[bi]];
    const halb = Math.max(20, R / 2);
    for (const schrittRichtung of [-1, 1]) {
      let l = 0, i = bi;
      for (;;) {
        let j = i + schrittRichtung;
        if (best.geschlossen) j = (j + pk.length) % pk.length;
        if (j < 0 || j >= pk.length || j === bi) break;
        l += Math.hypot(pk[j][0] - pk[i][0], pk[j][1] - pk[i][1]);
        if (l > halb) break;
        stueck.push(pk[j]); i = j;
      }
    }
    if (stueck.length < 6) return null;
    return robust(linieFit, stueck, restLinie);
  }

  // ── Maße (in Pixel; Umrechnung in mm durch mmPx) ─────────────────────────────
  function lot(p, e) { return Math.abs((p[0] - e.p[0]) * -e.d[1] + (p[1] - e.p[1]) * e.d[0]); }
  function mass(a, b) {
    if (!b) {
      if (a.art === 'kreis') return { art: 'durchmesser', wert: 2 * a.r, laenge: true, text: 'Ø' };
      if (a.art === 'linie') return { art: 'laenge', wert: Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1]), laenge: true, text: 'Länge' };
      return null;
    }
    const ort = (e) => (e.art === 'kreis' ? e.c : e.p);
    if (a.art === 'linie' && b.art === 'linie') {
      const w = Math.acos(Math.min(1, Math.abs(a.d[0] * b.d[0] + a.d[1] * b.d[1]))) * 180 / Math.PI;
      if (w <= 2) return { art: 'abstand', wert: (lot(b.p, a) + lot(a.p, b)) / 2, laenge: true, text: 'Abstand ∥' };
      return { art: 'winkel', wert: w, laenge: false, text: 'Winkel' };
    }
    if (a.art === 'linie' || b.art === 'linie') {
      const L = a.art === 'linie' ? a : b, o = a.art === 'linie' ? b : a;
      return { art: 'abstand', wert: lot(ort(o), L), laenge: true, text: 'Abstand zur Linie' };
    }
    const p = ort(a), q = ort(b);
    return { art: 'abstand', wert: Math.hypot(p[0] - q[0], p[1] - q[1]), laenge: true, text: a.art === 'kreis' && b.art === 'kreis' ? 'Mitte–Mitte' : 'Abstand' };
  }

  // ── Export (y nach oben, mm) ────────────────────────────────────────────────
  function export2d(elemente, mmPx, hoehePx, art, breitePx) {
    const X = (x) => x * mmPx, Y = (y) => (hoehePx - y) * mmPx, f = (v) => v.toFixed(4);
    if (art === 'dxf') {
      const z = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
      for (const e of elemente) {
        if (e.art === 'kreis') z.push('0', 'CIRCLE', '8', 'MESSUNG', '10', f(X(e.c[0])), '20', f(Y(e.c[1])), '40', f(e.r * mmPx));
        else if (e.art === 'linie') z.push('0', 'LINE', '8', 'MESSUNG', '10', f(X(e.a[0])), '20', f(Y(e.a[1])), '11', f(X(e.b[0])), '21', f(Y(e.b[1])));
        else z.push('0', 'POINT', '8', 'MESSUNG', '10', f(X(e.p[0])), '20', f(Y(e.p[1])));
      }
      z.push('0', 'ENDSEC', '0', 'EOF');
      return z.join('\r\n') + '\r\n';
    }
    const W = (breitePx || hoehePx) * mmPx, H = hoehePx * mmPx;
    const teile = elemente.map((e) => e.art === 'kreis' ? `<circle cx="${f(X(e.c[0]))}" cy="${f(H - Y(e.c[1]))}" r="${f(e.r * mmPx)}"/>`
      : e.art === 'linie' ? `<line x1="${f(X(e.a[0]))}" y1="${f(H - Y(e.a[1]))}" x2="${f(X(e.b[0]))}" y2="${f(H - Y(e.b[1]))}"/>`
        : `<circle cx="${f(X(e.p[0]))}" cy="${f(H - Y(e.p[1]))}" r="0.2"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}mm" height="${f(H)}mm" viewBox="0 0 ${f(W)} ${f(H)}"><g fill="none" stroke="#000" stroke-width="0.1">${teile}</g></svg>\n`;
  }

  const API = { dpiAus, grau, otsu, ketten, linieFit, kreisFit, elementAnKlick, mass, export2d };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }
  root.V3DFlachbett = API;

  // ═══ Oberfläche (Werkzeugfenster „2D-Messen“) ═══════════════════════════════
  const PROFIL_KEY = 'v3dscan_scannerprofile';
  const F = { bild: null, w: 0, h: 0, grau: null, schwelle: 0.5, mmPx: null, quelle: 'keine', dpi: null,
    sicht: { s: 1, ox: 0, oy: 0 }, werkzeug: 'kreis', elemente: [], masse: [], wahl: [], name: '' };
  root.V3DFlachbett.F = F;
  const $q = (s) => document.querySelector(s);
  const hinweis = (t, art) => (root.v3dscan && root.v3dscan.meldung ? root.v3dscan.meldung(t, art) : console.log(t));
  const mm = (px) => (F.mmPx ? px * F.mmPx : null);
  const zahl = (v, st = 3) => v.toLocaleString('de-DE', { minimumFractionDigits: st, maximumFractionDigits: st });

  function profile() { try { return JSON.parse(localStorage.getItem(PROFIL_KEY) || '{}'); } catch (e) { return {}; } }
  function profilListe() {
    const sel = $q('#fbProfil'); if (!sel) return;
    const p = profile();
    sel.innerHTML = '<option value="">— Maßstab aus der Datei —</option>' + Object.keys(p).map((n) => `<option>${n.replace(/</g, '&lt;')}</option>`).join('');
  }
  async function bildLaden(datei) {
    const buf = await datei.arrayBuffer();
    const dpi = dpiAus(buf);
    const bmp = await createImageBitmap(new Blob([buf]));
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
    Object.assign(F, { bild: c, w: c.width, h: c.height, grau: grau(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height),
      dpi, mmPx: dpi ? 25.4 / dpi : null, quelle: dpi ? 'dpi' : 'keine', elemente: [], masse: [], wahl: [], name: datei.name.replace(/\.[^.]+$/, '') });
    F.schwelle = otsu(F.grau);
    const p = profile(), wahl = $q('#fbProfil') && $q('#fbProfil').value;
    if (wahl && p[wahl]) { F.mmPx = p[wahl]; F.quelle = 'profil'; }
    einpassenSicht(); zeichnen(); liste();
    hinweis(`${datei.name}: ${F.w} × ${F.h} px${dpi ? `, ${Math.round(dpi)} dpi` : ', ohne dpi-Angabe'}`, 'ok');
  }
  function einpassenSicht() {
    const cv = $q('#fbLeinwand'); if (!cv || !F.bild) return;
    const s = Math.min(cv.width / F.w, cv.height / F.h);
    F.sicht = { s, ox: (cv.width - F.w * s) / 2, oy: (cv.height - F.h * s) / 2 };
  }
  const zuBild = (x, y) => [(x - F.sicht.ox) / F.sicht.s, (y - F.sicht.oy) / F.sicht.s];
  const zuSchirm = (x, y) => [x * F.sicht.s + F.sicht.ox, y * F.sicht.s + F.sicht.oy];

  function zeichnen() {
    const cv = $q('#fbLeinwand'); if (!cv) return;
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#2b2f36'; g.fillRect(0, 0, cv.width, cv.height);
    if (!F.bild) { g.fillStyle = '#aab'; g.font = '14px sans-serif'; g.textAlign = 'center'; g.fillText('Flachbettscan (PNG/JPEG) laden oder hierher ziehen', cv.width / 2, cv.height / 2); return; }
    g.imageSmoothingEnabled = F.sicht.s < 1;
    g.setTransform(F.sicht.s, 0, 0, F.sicht.s, F.sicht.ox, F.sicht.oy); g.drawImage(F.bild, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    F.elemente.forEach((e, i) => {
      const gew = F.wahl.includes(i);
      g.strokeStyle = gew ? '#ff9f1a' : '#19c3ff'; g.fillStyle = g.strokeStyle; g.lineWidth = gew ? 3 : 2;
      g.beginPath();
      if (e.art === 'kreis') { const [x, y] = zuSchirm(e.c[0], e.c[1]); g.arc(x, y, e.r * F.sicht.s, 0, Math.PI * 2); g.moveTo(x - 5, y); g.lineTo(x + 5, y); g.moveTo(x, y - 5); g.lineTo(x, y + 5); }
      else if (e.art === 'linie') { const a = zuSchirm(e.a[0], e.a[1]), b = zuSchirm(e.b[0], e.b[1]); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
      else { const [x, y] = zuSchirm(e.p[0], e.p[1]); g.arc(x, y, 4, 0, Math.PI * 2); }
      g.stroke();
      const o = e.art === 'kreis' ? e.c : e.art === 'linie' ? [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2] : e.p;
      const [lx, ly] = zuSchirm(o[0], o[1]); g.font = 'bold 12px sans-serif'; g.fillText('E' + (i + 1), lx + 6, ly - 6);
    });
  }
  function eintragText(m) {
    if (!m.laenge) return `${zahl(m.wert, 3)}°`;
    return F.mmPx ? `${zahl(m.wert * F.mmPx, 3)} mm` : `${zahl(m.wert, 2)} px`;
  }
  function liste() {
    const st = $q('#fbStatus');
    if (st) {
      st.textContent = !F.bild ? '' : F.quelle === 'kalibriert' ? `kalibriert · ${zahl(F.mmPx * 1000, 3)} µm/px`
        : F.quelle === 'profil' ? `Scanner-Profil · ${zahl(F.mmPx * 1000, 3)} µm/px`
          : F.quelle === 'dpi' ? `UNKALIBRIERT · ${Math.round(F.dpi)} dpi aus der Datei` : 'UNKALIBRIERT · ohne Maßstab (Pixel)';
      st.className = 'fbStatus ' + (F.quelle === 'kalibriert' || F.quelle === 'profil' ? 'gut' : 'warn');
    }
    const el = $q('#fbListe'); if (!el) return;
    const ez = F.elemente.map((e, i) => `<tr><td>E${i + 1}</td><td>${{ kreis: 'Kreis', linie: 'Linie', punkt: 'Punkt' }[e.art]}</td><td>${e.art === 'kreis' ? 'Ø ' + eintragText({ wert: 2 * e.r, laenge: true }) : e.art === 'linie' ? eintragText({ wert: Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]), laenge: true }) : ''}</td><td>σ ${F.mmPx ? zahl(e.rms * F.mmPx * 1000, 1) + ' µm' : zahl(e.rms, 2) + ' px'}</td><td><button data-fbweg="e${i}" title="Element löschen">×</button></td></tr>`).join('');
    const mz = F.masse.map((m, i) => `<tr><td>M${i + 1}</td><td>${m.text}</td><td>${m.namen}</td><td><b>${eintragText(m)}</b></td><td><button data-fbkal="${i}" title="Dieses Maß als bekanntes Maß zum Kalibrieren nehmen" ${m.laenge ? '' : 'disabled'}>⚖</button><button data-fbweg="m${i}" title="Maß löschen">×</button></td></tr>`).join('');
    el.innerHTML = `<table class="fbTab">${ez}</table><table class="fbTab">${mz}</table>`;
  }
  function klick(ev) {
    if (!F.bild) return;
    const cv = $q('#fbLeinwand'), r = cv.getBoundingClientRect();
    const sx = (ev.clientX - r.left) * cv.width / r.width, sy = (ev.clientY - r.top) * cv.height / r.height;
    const [bx, by] = zuBild(sx, sy);
    if (F.werkzeug === 'waehlen') {
      let best = -1, bd = 12 / F.sicht.s;
      F.elemente.forEach((e, i) => {
        const d = e.art === 'kreis' ? Math.abs(Math.hypot(bx - e.c[0], by - e.c[1]) - e.r) : e.art === 'linie' ? lot([bx, by], e) : Math.hypot(bx - e.p[0], by - e.p[1]);
        if (d < bd) { bd = d; best = i; }
      });
      if (best < 0) return;
      F.wahl = F.wahl.includes(best) ? F.wahl.filter((i) => i !== best) : F.wahl.concat(best).slice(-2);
      zeichnen(); return;
    }
    const e = elementAnKlick(F.grau, F.w, F.h, F.schwelle, F.werkzeug, bx, by, Math.max(150, 260 / F.sicht.s));
    if (!e) { hinweis('Hier keine passende Kante gefunden – näher an die Kante klicken.', 'warn'); return; }
    F.elemente.push(e); F.wahl = [F.elemente.length - 1]; zeichnen(); liste();
  }
  function massAusWahl() {
    if (!F.wahl.length) throw new Error('Erst ein oder zwei Elemente wählen (Werkzeug „Wählen“).');
    const [i, j] = F.wahl, m = mass(F.elemente[i], j === undefined ? null : F.elemente[j]);
    if (!m) throw new Error('Für dieses Element allein gibt es kein Maß.');
    m.namen = 'E' + (i + 1) + (j === undefined ? '' : ' – E' + (j + 1));
    F.masse.push(m); liste();
  }
  function kalibrieren(i) {
    const m = F.masse[i];
    const soll = parseFloat(String(prompt(`Wie groß ist ${m.text} ${m.namen} wirklich (mm)?`, '') || '').replace(',', '.'));
    if (!(soll > 0)) return;
    F.mmPx = soll / m.wert; F.quelle = 'kalibriert'; liste();
    const name = prompt('Als Scanner-Profil speichern? Name (leer = nicht speichern):', '');
    if (name) { const p = profile(); p[name] = F.mmPx; localStorage.setItem(PROFIL_KEY, JSON.stringify(p)); profilListe(); $q('#fbProfil').value = name; }
    hinweis(`Kalibriert: ${zahl(F.mmPx * 1000, 3)} µm je Pixel`, 'ok');
  }
  function laden(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  function exportieren(art) {
    if (!F.elemente.length) throw new Error('Noch keine Elemente.');
    if (!F.mmPx) throw new Error('Ohne Maßstab kein Export in mm – erst kalibrieren.');
    const t = export2d(F.elemente, F.mmPx, F.h, art, F.w);
    laden(new Blob([t], { type: art === 'dxf' ? 'application/dxf' : 'image/svg+xml' }), `${F.name || 'flachbett'}.${art}`);
  }
  function bericht() {
    const z = [`2D-Messung V3D Scan – ${F.name} – ${new Date().toLocaleString('de-DE')}`, `Maßstab: ${$q('#fbStatus').textContent}`, ''];
    F.elemente.forEach((e, i) => z.push(`E${i + 1}  ${e.art}${e.art === 'kreis' ? '  Ø ' + eintragText({ wert: 2 * e.r, laenge: true }) : ''}`));
    z.push('');
    F.masse.forEach((m, i) => z.push(`M${i + 1}  ${m.text} ${m.namen}  ${eintragText(m)}`));
    return z.join('\n');
  }
  function weg(k) {
    if (k[0] === 'm') F.masse.splice(+k.slice(1), 1);
    else { F.elemente.splice(+k.slice(1), 1); F.wahl = []; F.masse = []; hinweis('Element gelöscht – die Maße darauf auch.', ''); }
    zeichnen(); liste();
  }
  function binden() {
    const cv = $q('#fbLeinwand'); if (!cv || cv.dataset.gebunden) return;
    cv.dataset.gebunden = '1';
    let zug = null;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('mousedown', (e) => { if (e.button !== 0 || e.shiftKey) zug = { x: e.clientX, y: e.clientY, ox: F.sicht.ox, oy: F.sicht.oy }; });
    window.addEventListener('mousemove', (e) => { if (!zug) return; const k = cv.width / cv.getBoundingClientRect().width; F.sicht.ox = zug.ox + (e.clientX - zug.x) * k; F.sicht.oy = zug.oy + (e.clientY - zug.y) * k; zeichnen(); });
    window.addEventListener('mouseup', () => { zug = null; });
    cv.addEventListener('click', (e) => { if (!e.shiftKey) klick(e); });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault(); e.stopPropagation();
      const r = cv.getBoundingClientRect(), sx = (e.clientX - r.left) * cv.width / r.width, sy = (e.clientY - r.top) * cv.height / r.height;
      const [bx, by] = zuBild(sx, sy), f = Math.exp(-e.deltaY * 0.0015);
      F.sicht.s = Math.min(40, Math.max(0.02, F.sicht.s * f)); F.sicht.ox = sx - bx * F.sicht.s; F.sicht.oy = sy - by * F.sicht.s; zeichnen();
    }, { passive: false });
    cv.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
    cv.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); const d = e.dataTransfer.files[0]; if (d) bildLaden(d).catch((x) => hinweis(x.message, 'fehler')); });
    $q('#fbDatei').addEventListener('change', (e) => { const d = e.target.files[0]; if (d) bildLaden(d).catch((x) => hinweis(x.message, 'fehler')); e.target.value = ''; });
    $q('#fbProfil').addEventListener('change', (e) => { const p = profile(); if (p[e.target.value]) { F.mmPx = p[e.target.value]; F.quelle = 'profil'; } else if (F.dpi) { F.mmPx = 25.4 / F.dpi; F.quelle = 'dpi'; } liste(); });
    $q('#fbWerkzeuge').addEventListener('click', (e) => { const b = e.target.closest('[data-fbw]'); if (!b) return; F.werkzeug = b.dataset.fbw; document.querySelectorAll('#fbWerkzeuge [data-fbw]').forEach((x) => x.classList.toggle('an', x === b)); });
    $q('#fbListe').addEventListener('click', (e) => {
      const w = e.target.closest('[data-fbweg]'), k = e.target.closest('[data-fbkal]');
      if (w) weg(w.dataset.fbweg); else if (k) kalibrieren(+k.dataset.fbkal);
    });
    const knopf = (sel, fn) => $q(sel).addEventListener('click', () => { try { fn(); } catch (x) { hinweis(x.message, 'fehler'); } });
    knopf('#fbMass', massAusWahl);
    knopf('#fbDxf', () => exportieren('dxf'));
    knopf('#fbSvg', () => exportieren('svg'));
    knopf('#fbBericht', () => { const t = bericht(); navigator.clipboard.writeText(t).then(() => hinweis('Bericht in der Zwischenablage.', 'ok'), () => laden(new Blob([t], { type: 'text/plain' }), `${F.name}_2d.txt`)); });
    knopf('#fbEinpassen', () => { einpassenSicht(); zeichnen(); });
  }
  root.V3DFlachbett.oeffnen = () => { binden(); profilListe(); einpassenSicht(); zeichnen(); liste(); };
})(typeof window !== 'undefined' ? window : this);
