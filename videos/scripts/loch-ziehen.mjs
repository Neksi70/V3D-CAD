/* Howto: Loch in einen Körper ziehen — Sackloch und Durchgangsloch.
 *
 * Entstanden aus Ralfs Bitte (10.10.2026, „brauch mal ein Video"): Er hatte
 * „⊙ Kreismuster" für das Loch-Werkzeug gehalten. Seit v1.18.162 führt
 * Werkzeuge → 🕳️ Loch ziehen in drei Schritten durch: Fläche → Kreis → ziehen.
 * Ruhiges Tempo, jeder Schritt eine Szene, getippte Tasten werden eingeblendet.
 */

/** Weltpunkt → Bildschirm, aber nur, wenn dort wirklich die Oberseite eines Körpers liegt. */
const aufFlaeche = (v, p) =>
  v.eval((p) => {
    const cv = renderer.domElement, r = cv.getBoundingClientRect();
    const q = new THREE.Vector3(p[0], p[1], p[2]).project(camera);
    const bx = r.left + (q.x * 0.5 + 0.5) * r.width, by = r.top + (-q.y * 0.5 + 0.5) * r.height;
    for (let d = 0; d <= 40; d += 3)
      for (const [ox, oy] of [[0,0],[d,0],[-d,0],[0,d],[0,-d]]) {
        const x = bx + ox, y = by + oy;
        if (document.elementFromPoint(x, y) !== cv) continue;
        // Kantenlinien liegen mit im Fangbereich — nur echte Netz-Treffer zählen
        const h = pickObjects({ clientX: x, clientY: y }).find((h) => h.object.isMesh && h.face);
        if (!h) continue;
        const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
        if (n.y > 0.9) return { x, y };
      }
    return { x: bx, y: by };
  }, p);

/** Getippte Taste groß einblenden — sonst sieht man im Video nicht, was passiert. */
const taste = (v, txt) =>
  v.eval((t) => {
    let el = document.getElementById('__vid_key');
    if (!el) {
      el = document.createElement('div');
      el.id = '__vid_key';
      el.style.cssText =
        'position:fixed;left:50%;top:230px;transform:translateX(-50%);z-index:2147483000;' +
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

async function druecke(v, key, anzeige, ms = 650) {
  await taste(v, anzeige);
  await v.page.keyboard.press(key);
  await v.sleep(ms);
}

/** Werkzeuge → Loch ziehen über das echte Menü. */
async function lochStarten(v) {
  await v.click('#tool-dd-btn', { after: 450 });
  await v.click('#tool-dd-list .shp:has-text("Loch ziehen")', { after: 600 });
}

/** Mitte anklicken, Durchmesser tippen, Enter. */
async function kreis(v, p, mm) {
  await v.clickAt(p, { moveMs: 600, after: 500 });
  for (const ch of String(mm)) await druecke(v, ch, String(mm).slice(0, String(mm).indexOf(ch) + 1), 380);
  await v.sleep(300);
  await druecke(v, 'Enter', 'Enter', 700);
  await taste(v, '');
}

/** In den Kreis drücken, sichtbar nach unten ziehen; extra(v) läuft bei gedrückter Maus. */
async function ziehRunter(v, p, px, extra) {
  await v.moveTo(p, 500);
  await v.eval(() => { window.__g0 = objects[0] && objects[0].geometry.uuid; });
  await v.page.mouse.down();
  const ms = 1500, N = 24;
  await v.eval(([x, y, d]) => window.__vid.glide(x, y, d), [p.x, p.y + px, ms]);
  for (let i = 1; i <= N; i++) {
    await v.page.mouse.move(p.x, p.y + (px * i) / N);
    await v.sleep(ms / N);
  }
  await v.sleep(500);
  if (extra) await extra(v);
  await v.page.mouse.up();
  await taste(v, '');
  await v.until(() => objects[0] && objects[0].geometry.uuid !== window.__g0 && !_sk.hole,
    { timeout: 60000, msg: 'Loch geschnitten' });
  // Ergebnis nicht ausgewählt lassen: Gizmo und Maß-Fenster lenken nur ab
  await v.eval(() => selectObjs([]));
  await v.sleep(400);
}

/** Kamera weich auf einen Höhenwinkel fahren (Orbit per Maus würde Objekte greifen). */
const schwenk = (v, phi, theta, ms = 1600) =>
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

export default {
  id: 'loch-ziehen',
  modal: null,                 // kein eigenes Fenster: Knopf sitzt in der Loch-Hinweisleiste
  title: 'Löcher einfach ziehen',
  subtitle: 'Sackloch und Durchgangsloch in drei Schritten',
  icon: '🕳️',

  introText:
    'Moin! So bohrst du ein Loch in einen Körper — in drei Schritten.',

  outroTitle: 'Loch fertig!',
  outroText:
    'Fläche, Kreis, nach unten ziehen — das ist alles. ' +
    'Mit Gewinde an Fläche passt danach sogar ein Gewinde ins Loch.',

  tags: ['loch', 'bohrung', 'sackloch', 'durchgangsloch', 'skizze', 'anfaenger'],

  async ready(v) {
    await v.eval(() => {
      if (typeof hideStarter === 'function') hideStarter();
      document.getElementById('start-modal')?.classList.remove('show');
      document.getElementById('auth-overlay')?.classList.add('hidden');
      // Quader 40 × 40 × 20 mm mittig auf der Platte
      _newCreate(false); resetWorkplane(); addShape('box');
      const o = objects[objects.length - 1];
      const s = getMeshBox(o).getSize(new THREE.Vector3());
      o.scale.multiply(new THREE.Vector3(4 / s.x, 2 / s.y, 4 / s.z)); o.updateMatrixWorld(true);
      o.position.set(0, 0, 0); o.updateMatrixWorld(true);
      o.position.y -= getMeshBox(o).min.y; o.updateMatrixWorld(true);
      o.userData.name = 'Quader';
      selectObjs([]);
      fitView();
      sph.phi = 0.95; sph.theta = 0.55; sph.r *= 1.15; sph2cam(); camera.updateMatrixWorld(true);
    });
  },

  scenes: [
    {
      kapitel: 'Werkzeug öffnen',
      say: 'Hier liegt ein Quader. Rechts unter Werkzeuge öffnen findest du: Loch ziehen.',
      run: async (v) => {
        await v.sleep(1500);
        await lochStarten(v);
      },
    },
    {
      kapitel: 'Schritt 1: Fläche',
      say: 'Schritt eins: Klick auf die Fläche, in die das Loch soll. Oben steht immer der nächste Schritt.',
      run: async (v) => {
        await v.sleep(600);
        await v.clickAt(await aufFlaeche(v, [-1, 2, 0]), { moveMs: 700, after: 500 });
        await v.spot('#sk-hole-tip', 6).catch(() => {});
        await v.sleep(2200);
        await v.unspot().catch(() => {});
      },
    },
    {
      kapitel: 'Schritt 2: Kreis',
      say: 'Schritt zwei: Klick auf die Mitte des Lochs. Dann zehn tippen und Enter — das ist der Durchmesser in Millimetern.',
      run: async (v) => {
        await v.sleep(700);
        await kreis(v, await aufFlaeche(v, [-1, 2, 0]), 10);
      },
    },
    {
      kapitel: 'Schritt 3: Ziehen',
      say: 'Schritt drei: in den Kreis klicken, Maustaste halten und nach unten ziehen. Rot heißt: Loch. Tippst du dabei acht, wird es genau acht Millimeter tief. Loslassen.',
      run: async (v) => {
        await v.sleep(600);
        await ziehRunter(v, await aufFlaeche(v, [-1, 2, 0]), 70, async (v) => {
          await druecke(v, '8', '8', 1400);
        });
      },
    },
    {
      kapitel: 'Sackloch',
      say: 'Fertig ist das Sackloch — mit Boden.',
      run: async (v) => {
        await schwenk(v, 0.55, null, 1500);
      },
    },
    {
      kapitel: 'Durchgangsloch',
      say: 'Jetzt ein Loch ganz hindurch: wieder Loch ziehen, Fläche anklicken, Mitte anklicken, zehn, Enter.',
      run: async (v) => {
        await schwenk(v, 0.95, null, 900);
        await lochStarten(v);
        await v.clickAt(await aufFlaeche(v, [1, 2, 0]), { moveMs: 600, after: 500 });
        await kreis(v, await aufFlaeche(v, [1, 2, 0]), 10);
      },
    },
    {
      kapitel: 'D = durch alles',
      say: 'Beim Ziehen drückst du die Taste D — D heißt: durch alles. Loslassen, fertig.',
      run: async (v) => {
        await ziehRunter(v, await aufFlaeche(v, [1, 2, 0]), 60, async (v) => {
          await druecke(v, 'd', 'D', 1300);
        });
      },
    },
    {
      kapitel: 'Ergebnis',
      say: 'Von unten sieht man: dieses Loch geht ganz durch.',
      run: async (v) => {
        await schwenk(v, 2.2, null, 2000);
        await v.sleep(600);
      },
    },
  ],
};
