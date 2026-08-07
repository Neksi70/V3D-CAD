/* Szenen-API für die Drehbücher.
 *
 * Jede Aktion bewegt IMMER beides: die echte Playwright-Maus (damit die App
 * Hover-Zustände zeigt und Klicks wirklich ankommen) und den gemalten Zeiger
 * im Overlay (damit man im Video sieht, wohin geklickt wird).
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Schrittfolge auf eine Soll-Gesamtdauer takten.
 *
 * Jeder Playwright-Aufruf kostet einen Roundtrip (bei laufendem 3D-Rendering
 * gern 50–150 ms). Mit festem sleep pro Schritt zieht sich eine Bewegung
 * dadurch auf ein Vielfaches — die Szene läuft dann dem gesprochenen Satz
 * davon. Deshalb wird hier gegen die Uhr gearbeitet: geschlafen wird nur die
 * Zeit, die der Aufruf nicht schon selbst verbraucht hat.
 */
async function paced(steps, ms, fn) {
  const t0 = Date.now();
  for (let i = 1; i <= steps; i++) {
    await fn(i / steps, i);
    const soll = (ms * i) / steps;
    const rest = soll - (Date.now() - t0);
    if (rest > 0) await sleep(rest);
  }
}

export function makeApi(page, log) {
  /** Mittelpunkt eines Elements in Viewport-Koordinaten. */
  async function center(sel) {
    const el = page.locator(sel).first();
    await el.waitFor({ state: 'visible', timeout: 15000 });
    // Absicherung: liegt das Ziel außerhalb des Sichtbereichs, zeigt der
    // gemalte Cursor sonst irgendwohin und der Klick geht daneben.
    await el.scrollIntoViewIfNeeded().catch(() => {});
    const b = await el.boundingBox();
    if (!b) throw new Error(`kein Kasten für ${sel}`);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }

  const api = {
    page,
    log,
    sleep,

    /** Zeiger sichtbar zu einem Element/Punkt führen. */
    async moveTo(target, ms = 520) {
      const p = typeof target === 'string' ? await center(target) : target;
      const t0 = Date.now();
      // Overlay animiert selbstständig weiter und meldet nur die Dauer zurück
      const dur = await page.evaluate(
        ([x, y, d]) => window.__vid.glide(x, y, d),
        [p.x, p.y, ms]
      );
      await page.mouse.move(p.x, p.y, { steps: 6 });
      const rest = dur - (Date.now() - t0);
      if (rest > 0) await sleep(rest);
      return p;
    },

    /** Hinführen, Welle zeigen, klicken. */
    async click(sel, { moveMs = 520, after = 260 } = {}) {
      const p = await api.moveTo(sel, moveMs);
      await page.evaluate(() => window.__vid.click());
      await sleep(120);
      await page.mouse.click(p.x, p.y);
      if (after) await sleep(after);
    },

    /**
     * Klick auf eine Bildschirmposition statt auf ein Element.
     * Für Zeichenflächen: dort gibt es keine Selektoren, aber der Zuschauer
     * muss trotzdem sehen, wohin geklickt wird.
     */
    async clickAt(punkt, { moveMs = 520, after = 260 } = {}) {
      await api.moveTo(punkt, moveMs);
      await page.evaluate(() => window.__vid.click());
      await sleep(120);
      await page.mouse.click(punkt.x, punkt.y);
      if (after) await sleep(after);
    },

    /** Text zeichenweise eintippen — Tippen soll man sehen. */
    async type(sel, text, { clear = true, delay = 85 } = {}) {
      await api.click(sel, { after: 120 });
      if (clear) {
        await page.locator(sel).first().fill('');
        await page.locator(sel).first().dispatchEvent('input');
      }
      await page.locator(sel).first().pressSequentially(text, { delay });
      await page.locator(sel).first().dispatchEvent('change');
      await sleep(200);
    },

    /**
     * Schieberegler sichtbar ziehen: der Zeiger wandert am Regler entlang und
     * der Wert läuft mit — ein blindes .fill() sieht im Video nach nichts aus.
     */
    async slider(sel, value, { ms = 900 } = {}) {
      const el = page.locator(sel).first();
      await el.waitFor({ state: 'visible' });
      const b = await el.boundingBox();
      const { min, max, cur } = await el.evaluate((n) => ({
        min: parseFloat(n.min || 0),
        max: parseFloat(n.max || 100),
        cur: parseFloat(n.value),
      }));
      const frac = (v) => (v - min) / (max - min || 1);
      const xOf = (v) => b.x + 8 + (b.width - 16) * frac(v);
      const y = b.y + b.height / 2;

      await api.moveTo({ x: xOf(cur), y }, 420);
      await page.mouse.down();
      // Der gemalte Zeiger fährt die Strecke selbst ab; hier nur die echten
      // Mausereignisse takten, damit der Wert sichtbar mitläuft.
      await page.evaluate(
        ([x, py, d]) => window.__vid.glide(x, py, d),
        [xOf(value), y, ms]
      );
      await paced(Math.max(8, Math.round(ms / 60)), ms, async (t) => {
        await page.mouse.move(xOf(cur + (value - cur) * t), y);
      });
      await page.mouse.up();
      // exakter Endwert, falls die Pixelrasterung danebenliegt
      await el.evaluate((n, v) => {
        n.value = v;
        n.dispatchEvent(new Event('input', { bubbles: true }));
        n.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
      await sleep(260);
    },

    /** Auswahlfeld setzen (mit Zeiger-Anfahrt, damit es sichtbar bleibt). */
    async select(sel, value) {
      await api.moveTo(sel, 450);
      await page.locator(sel).first().selectOption(value);
      await sleep(320);
    },

    /** Sanft zu einem Element scrollen — im Video besser als ein Sprung. */
    async scroll(sel, { hold = 700 } = {}) {
      await page
        .locator(sel)
        .first()
        .evaluate((n) =>
          n.scrollIntoView({ behavior: 'smooth', block: 'center' })
        );
      await sleep(hold);
    },

    /**
     * Datei über die sichtbare Schaltfläche laden.
     *
     * Der Klick wird echt ausgeführt und der native Dateidialog abgefangen —
     * so sieht man im Video den Zeiger auf der Schaltfläche, ohne dass ein
     * Systemfenster die Aufnahme blockiert.
     */
    async upload(sel, datei, { after = 800 } = {}) {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 15000 }),
        api.click(sel, { after: 0 }),
      ]);
      await chooser.setFiles(datei);
      if (after) await sleep(after);
    },

    /** Kontrollkästchen auf den gewünschten Zustand bringen. */
    async check(sel, on = true) {
      const el = page.locator(sel).first();
      const is = await el.isChecked();
      if (is !== on) await api.click(sel);
    },

    /**
     * Ansicht auf alle Körper zentrieren und passend zoomen.
     *
     * Vor jedem Drehen nötig: Wie groß und wo ein Generator-Ergebnis landet,
     * ist je nach Bauteil verschieden — ohne das rutscht das Modell beim
     * Zoomen aus dem Bild.
     */
    async fit({ hold = 500 } = {}) {
      const ok = await page.evaluate(() => {
        if (typeof window.fitView !== 'function') return false;
        window.fitView();
        return true;
      });
      if (!ok) log('  ⚠ fitView() nicht verfügbar — Ansicht bleibt, wie sie ist');
      await sleep(hold);
      return ok;
    },

    /** Modell in der 3D-Ansicht drehen — zeigt das Ergebnis von allen Seiten. */
    async orbit({ dx = 320, dy = -60, ms = 1600, from } = {}) {
      const start = from || { x: 960, y: 560 };
      await api.moveTo(start, 420);
      // RECHTE Taste: die App dreht nur mit button 2 — links zieht Objekte,
      // die Mitte schiebt die Ansicht. Mit links würde man im Video das
      // Modell verschieben statt die Kamera zu drehen.
      await page.mouse.down({ button: 'right' });
      await page.evaluate(
        ([x, y, d]) => window.__vid.glide(x, y, d),
        [start.x + dx, start.y + dy, ms]
      );
      await paced(Math.max(10, Math.round(ms / 55)), ms, async (t) => {
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        await page.mouse.move(start.x + dx * e, start.y + dy * e);
      });
      await page.mouse.up({ button: 'right' });
      await sleep(200);
    },

    /**
     * Scheinwerfer auf ein Bedienelement.
     *
     * Bei reinen CSS-Selektoren bleibt der Rahmen am Element kleben (Dialoge
     * blenden beim Umschalten Zeilen ein und aus). Playwright-Selektoren wie
     * :has-text() kennt querySelector nicht — die bekommen ein festes Rechteck.
     */
    async spot(sel, pad = 8) {
      const playwrightOnly = /:has-text\(|:text|^text=|>>|:visible|:nth-match/.test(sel);
      let ok = false;
      if (!playwrightOnly) {
        ok = await page.evaluate(
          ([s, p]) => window.__vid.follow(s, p),
          [sel, pad]
        );
      }
      if (!ok) {
        let box = null;
        try {
          const el = page.locator(sel).first();
          await el.waitFor({ state: 'visible', timeout: 4000 });
          box = await el.boundingBox();
        } catch {
          /* unten gemeldet */
        }
        ok = await page.evaluate(
          ([b, p]) => window.__vid.highlight(b, p),
          [box, pad]
        );
      }
      if (!ok) log(`  ⚠ Scheinwerfer: "${sel}" nicht sichtbar`);
      return ok;
    },
    async unspot() {
      await page.evaluate(() => window.__vid.unhighlight());
    },

    /** Warten, bis die App etwas erfüllt (z.B. Körper erzeugt). */
    async until(fn, { timeout = 90000, msg = 'Bedingung' } = {}) {
      const t0 = Date.now();
      for (;;) {
        if (await page.evaluate(fn)) return true;
        if (Date.now() - t0 > timeout) throw new Error(`Zeitüberschreitung: ${msg}`);
        await sleep(250);
      }
    },

    /** Code im Seitenkontext ausführen. */
    eval: (fn, arg) => page.evaluate(fn, arg),
  };

  return api;
}
