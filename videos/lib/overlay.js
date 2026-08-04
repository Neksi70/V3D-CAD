/* Bild-Ebene über der App, nur für die Videoaufnahme.
 *
 * Playwright zeichnet den echten Mauszeiger nicht mit auf — deshalb malen wir
 * einen eigenen, dazu Klick-Wellen, einen Scheinwerfer auf das gerade erklärte
 * Bedienelement und die Untertitel. Alles liegt in einem eigenen Overlay mit
 * pointer-events:none, damit die App darunter ganz normal bedienbar bleibt.
 *
 * Wird per addInitScript injiziert und ist danach als window.__vid verfügbar.
 */
(() => {
  if (window.__vid) return;

  const Z = 2147483000;

  // Beim Injizieren (addInitScript) ist das Dokument noch völlig leer — weder
  // head noch body existieren. Deshalb wird in zwei Stufen eingehängt, sobald
  // der jeweilige Knoten auftaucht.
  const early = document.createElement('style');
  early.textContent = 'html{background:#141821}';

  const root = document.createElement('div');
  root.id = '__vid_layer';
  root.style.cssText =
    `position:fixed;inset:0;z-index:${Z};pointer-events:none;` +
    `font-family:system-ui,-apple-system,"Segoe UI",sans-serif`;

  const style = document.createElement('style');
  style.textContent = `
    #__vid_layer *{box-sizing:border-box}
    @keyframes __vid_ripple{
      0%{transform:translate(-50%,-50%) scale(.25);opacity:.85}
      100%{transform:translate(-50%,-50%) scale(1);opacity:0}
    }
    @keyframes __vid_pulse{
      0%,100%{box-shadow:0 0 0 3px rgba(255,193,7,.95),0 0 26px 8px rgba(255,193,7,.45)}
      50%{box-shadow:0 0 0 3px rgba(255,193,7,.65),0 0 34px 14px rgba(255,193,7,.25)}
    }`;

  // ── Mauszeiger ────────────────────────────────────────────────────────────
  const cursor = document.createElement('div');
  cursor.style.cssText =
    'position:absolute;left:0;top:0;width:26px;height:26px;' +
    'margin:-2px 0 0 -2px;transition:none;will-change:transform';
  cursor.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 26 26">' +
    '<path d="M4 2 L4 20 L9 15.5 L12.5 23 L16 21.3 L12.6 14.2 L19 14 Z" ' +
    'fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  cursor.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,.5))';

  // ── Scheinwerfer ──────────────────────────────────────────────────────────
  const spot = document.createElement('div');
  spot.style.cssText =
    'position:absolute;border-radius:12px;opacity:0;transition:all .35s ease;' +
    'animation:__vid_pulse 1.6s ease-in-out infinite';

  // ── Untertitel ────────────────────────────────────────────────────────────
  const cap = document.createElement('div');
  cap.style.cssText =
    'position:absolute;left:50%;bottom:44px;transform:translateX(-50%);' +
    'max-width:66%;padding:12px 22px;border-radius:14px;opacity:0;' +
    'background:rgba(12,12,14,.86);color:#fff;font-size:25px;line-height:1.35;' +
    'font-weight:500;text-align:center;transition:opacity .22s ease;' +
    'text-shadow:0 1px 2px rgba(0,0,0,.6)';

  // ── Titelkarte (Intro/Outro) ──────────────────────────────────────────────
  const card = document.createElement('div');
  card.style.cssText =
    'position:absolute;inset:0;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:16px;opacity:0;' +
    'background:linear-gradient(135deg,#141821,#232a3a);color:#fff;' +
    'transition:opacity .4s ease';

  // ── Wasserzeichen ─────────────────────────────────────────────────────────
  const mark = document.createElement('div');
  mark.style.cssText =
    'position:absolute;right:26px;top:20px;font-size:17px;font-weight:700;' +
    'letter-spacing:.5px;color:rgba(255,255,255,.82);opacity:0;' +
    'text-shadow:0 1px 6px rgba(0,0,0,.8);transition:opacity .3s ease';
  mark.textContent = 'V3D CAD';

  root.append(style, spot, cap, cursor, card, mark);

  // Stufe 1: dunkler Grund, sobald es überhaupt einen Knoten gibt (verhindert
  // das weiße Aufblitzen am Videoanfang). Stufe 2: die Bild-Ebene in den body.
  let styleDone = false;
  const mount = () => {
    if (!styleDone) {
      const host = document.head || document.documentElement;
      if (host) {
        host.appendChild(early);
        styleDone = true;
      }
    }
    if (document.body && !document.getElementById('__vid_layer')) {
      document.body.appendChild(root);
    }
    return styleDone && !!root.parentNode;
  };
  if (!mount()) {
    const iv = setInterval(() => {
      if (mount()) clearInterval(iv);
    }, 8);
    document.addEventListener('DOMContentLoaded', mount);
  }

  // Titelkarte schon beim Injizieren setzen, falls der Runner sie mitgegeben
  // hat: Bei 2,5 MB Inline-HTML kehrt goto() erst zurück, wenn die App bereits
  // sichtbar ist — eine erst danach eingeblendete Karte käme zu spät und der
  // Zuschauer sähe die Ladephase.
  const pre = window.__vidCard;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  let cx = window.innerWidth / 2;
  let cy = window.innerHeight / 2;
  const place = () => {
    cursor.style.transform = `translate(${cx}px,${cy}px)`;
  };
  place();

  const durOf = (x, y, ms) =>
    Math.max(180, Math.min(ms, 120 + Math.hypot(x - cx, y - cy) * 1.1));

  let followRaf = 0;
  const stopFollow = () => {
    if (followRaf) cancelAnimationFrame(followRaf);
    followRaf = 0;
  };
  /** Rahmen auf ein Rechteck setzen (oder ausblenden). */
  const put = (box, pad) => {
    if (!box || (!box.width && !box.height)) {
      spot.style.opacity = '0';
      return false;
    }
    spot.style.left = box.x - pad + 'px';
    spot.style.top = box.y - pad + 'px';
    spot.style.width = box.width + pad * 2 + 'px';
    spot.style.height = box.height + pad * 2 + 'px';
    spot.style.opacity = '1';
    return true;
  };

  window.__vid = {
    /** Aktuelle Zeigerposition — der Runner spiegelt damit die echte Maus. */
    pos: () => ({ x: cx, y: cy }),

    /**
     * Wie moveTo, kehrt aber sofort zurück und liefert die Dauer in ms.
     * Der Runner wartet dann seinerseits — so kostet eine Zeigerfahrt nur
     * einen einzigen Roundtrip statt einen pro Einzelbild.
     */
    glide(x, y, ms = 520) {
      const d = durOf(x, y, ms);
      this.moveTo(x, y, ms);
      return d;
    },

    /** Zeiger weich zum Ziel führen (menschlich wirkende Bahn, ~ms Dauer). */
    async moveTo(x, y, ms = 520) {
      const sx = cx;
      const sy = cy;
      const dist = Math.hypot(x - sx, y - sy);
      if (dist < 1) return;
      const dur = durOf(x, y, ms);
      // leichter Bogen, damit die Bewegung nicht wie ein Lineal aussieht
      const bow = Math.min(60, dist * 0.16);
      const nx = -(y - sy) / (dist || 1);
      const ny = (x - sx) / (dist || 1);
      const t0 = performance.now();
      for (;;) {
        const p = Math.min(1, (performance.now() - t0) / dur);
        const e = ease(p);
        const arc = Math.sin(p * Math.PI) * bow;
        cx = sx + (x - sx) * e + nx * arc;
        cy = sy + (y - sy) * e + ny * arc;
        place();
        if (p >= 1) break;
        await new Promise(requestAnimationFrame);
      }
      cx = x;
      cy = y;
      place();
    },

    /** Klick-Welle an der aktuellen Position. */
    click() {
      const r = document.createElement('div');
      r.style.cssText =
        `position:absolute;left:${cx}px;top:${cy}px;width:54px;height:54px;` +
        'border-radius:50%;background:rgba(255,193,7,.55);' +
        'border:2px solid rgba(255,193,7,.9);' +
        'animation:__vid_ripple .5s ease-out forwards';
      root.appendChild(r);
      setTimeout(() => r.remove(), 520);
      cursor.style.transform = `translate(${cx}px,${cy}px) scale(.82)`;
      setTimeout(place, 110);
    },

    /**
     * Scheinwerfer auf ein Rechteck {x,y,width,height} in Viewport-Koordinaten.
     * Der Runner ermittelt es über Playwright, damit auch Selektoren wie
     * :has-text() funktionieren, die querySelector nicht kennt.
     */
    highlight(box, pad = 8) {
      stopFollow();
      return put(box, pad);
    },

    /**
     * Wie highlight, hält den Rahmen aber am Element fest. Nötig, weil viele
     * Dialoge beim Umschalten Zeilen ein- und ausblenden — ein einmal gesetzter
     * Rahmen zeigt danach ins Leere.
     */
    follow(sel, pad = 8) {
      stopFollow();
      const el = document.querySelector(sel);
      if (!el) return put(null, pad);
      const tick = () => {
        const e = document.querySelector(sel);
        if (!e || !e.isConnected) return put(null, pad);
        put(e.getBoundingClientRect(), pad);
        followRaf = requestAnimationFrame(tick);
      };
      tick();
      return true;
    },

    unhighlight() {
      stopFollow();
      spot.style.opacity = '0';
    },

    caption(text) {
      if (!text) {
        cap.style.opacity = '0';
        return;
      }
      cap.textContent = text;
      cap.style.opacity = '1';
    },

    watermark(on) {
      mark.style.opacity = on ? '1' : '0';
    },

    /** Vollflächige Titelkarte ein-/ausblenden. */
    async showCard(title, sub, icon) {
      card.innerHTML =
        (icon ? `<div style="font-size:96px;line-height:1">${icon}</div>` : '') +
        `<div style="font-size:62px;font-weight:800;letter-spacing:-1px">${title}</div>` +
        (sub
          ? `<div style="font-size:29px;opacity:.82;font-weight:400">${sub}</div>`
          : '');
      card.style.opacity = '1';
      cursor.style.opacity = '0';
      await sleep(420);
    },
    async hideCard() {
      card.style.opacity = '0';
      cursor.style.opacity = '1';
      await sleep(420);
    },

    cursorVisible(on) {
      cursor.style.opacity = on ? '1' : '0';
    },
  };

  if (pre) {
    // ohne Einblendung, damit schon der allererste Frame die Karte zeigt
    card.style.transition = 'none';
    window.__vid.showCard(pre.title, pre.sub, pre.icon);
    requestAnimationFrame(() => {
      card.style.transition = 'opacity .4s ease';
    });
  }
})();
