/* Kursvideo: Übung A (Grundkurs Tag 1) — Box mit Schiebedeckel.
 *
 * Folgt Folie „Box mit Schiebedeckel" im Foliensatz grundkurs (V3D Tafel) Schritt für
 * Schritt: Hohlkörper per Cutter + Ausrichten, Nut über Arbeitsebene mit Versatz,
 * Deckel mit Spielraum −0,2 und vertieftem Namen, dann Schnitt und Druck-Check.
 * Bauweg und Maße wie im getesteten Kursweg (~/bau_uebung_a_stl.mjs).
 * Oben steht je Schritt ein Schild mit Nummer und Maßen wie auf der Folie.
 */

/** Schritt-Schild im Stil der Folie: orange Nummer + Text (HTML erlaubt). */
const schild = (v, nr, html, grau = false) =>
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

/** Getippte Tasten groß einblenden. */
const taste = (v, txt) =>
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

/** Körper hinzufügen → Box über das echte Menü. */
async function neueBox(v) {
  await v.click('#shape-dd-btn', { after: 500 });
  await v.click('#shape-dd .shp[data-icon="box"]', { after: 700 });
}

/** Maße ins Eigenschaften-Fenster tippen (Länge X, Tiefe Y, Höhe Z). */
async function masse(v, w, d, h) {
  for (const [id, wert] of [['#fpw', w], ['#fpd', d], ['#fph', h]]) {
    await v.type(id, String(wert), { delay: 70 });
    await v.page.keyboard.press('Enter');
    await v.sleep(250);
  }
}

/** Beide Körper wählen (wie Strg+A) — Schild zeigt die Tasten. */
async function alleWaehlen(v) {
  await taste(v, 'Strg A');
  await v.eval(() => selectObjs(objects.slice()));
  await v.sleep(900);
  await taste(v, '');
}

/** ⊜ Ausrichten öffnen und die Punkte mit den genannten Tooltips anklicken. */
async function ausrichten(v, tips) {
  await v.click('button[onclick="alignTool()"]', { after: 600 });
  for (const tip of tips) {
    const p = await v.eval((t) => {
      const d = _alignHandleData.find((h) => h.tip.textContent === t);
      const r = d.el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, tip);
    await v.moveTo(p, 650);
    await v.eval((t) => { const d = _alignHandleData.find((h) => h.tip.textContent === t); d.tip.style.display = 'block'; }, tip);
    await v.sleep(450);
    await v.clickAt(p, { moveMs: 80, after: 700 });
  }
  await v.page.keyboard.press('Escape');
  await v.sleep(300);
}

/** ⊖ Abziehen und warten, bis nur noch ein fester Körper übrig ist. */
async function abziehen(v, anzahl = 1) {
  await v.eval(() => selectObjs(objects.slice()));
  await v.click('button[onclick="subtractHoles()"]', { after: 300 });
  await v.eval((n) => { window.__solls = n; }, anzahl);
  await v.until(() => objects.filter((o) => !o.userData.isHole).length === window.__solls && !objects.some((o) => o.userData.isHole),
    { timeout: 90000, msg: 'Abziehen fertig' });
  await v.eval(() => selectObjs([]));
  await v.sleep(500);
}

/** Bildschirmpunkt auf der obersten Fläche eines Körpers suchen (nicht projizieren — siehe Howto-Fallen).
 *  Nur Treffer auf der Höhe der Oberkante zählen: der Boden im Innenraum zeigt auch nach oben.
 *  rand = true zielt auf die Mitte der hinteren Wand (Box), sonst auf die Mitte (Deckel). */
const oberseite = (v, idx = 0, rand = false) =>
  v.eval(([idx, rand]) => {
    const o = objects[idx], b = new THREE.Box3().setFromObject(o), cv = renderer.domElement, r = cv.getBoundingClientRect();
    const z = rand ? b.max.z - 0.15 : (b.min.z + b.max.z) / 2;
    const q = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, z).project(camera);
    const bx = r.left + (q.x * 0.5 + 0.5) * r.width, by = r.top + (-q.y * 0.5 + 0.5) * r.height;
    for (let d = 0; d <= 60; d += 2)
      for (const [ox, oy] of [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d]]) {
        const x = bx + ox, y = by + oy;
        if (document.elementFromPoint(x, y) !== cv) continue;
        const h = pickObjects({ clientX: x, clientY: y }).find((h) => h.object.isMesh && h.face);
        if (!h || h.object !== o || Math.abs(h.point.y - b.max.y) > 0.005) continue;
        return { x, y };
      }
    throw new Error('Oberseite nicht gefunden');
  }, [idx, rand]);

/** Kamera weich fahren (Orbit per Maus würde Objekte greifen). */
const schwenk = (v, phi, theta, ms = 1500) =>
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

const blick = (v) => v.eval(() => { fitView(); sph.phi = 0.9; sph.theta = 0.6; sph.r *= 1.25; sph2cam(); });

export default {
  id: 'uebung-a-box',
  modal: null,
  title: 'Übung A: Box mit Schiebedeckel',
  subtitle: '3D-Druck Grundkurs · Tag 1',
  icon: '📦',

  introText: 'Moin! Übung A: Wir bauen eine Box mit Schiebedeckel — Schritt für Schritt, genau wie auf der Folie.',

  outroTitle: 'Box fertig!',
  outroText: 'Hohlkörper, Ausrichten, Arbeitsebene, Nut und Spiel — das war Übung A. Viel Spaß beim Drucken!',

  tags: ['grundkurs', 'box', 'schiebedeckel', 'nut', 'toleranz', 'anfaenger'],

  async ready(v) {
    await v.eval(() => {
      try { localStorage.setItem('v3d_umsteiger_hinweis', '1'); } catch (e) {}
      document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Alles klar') b.click(); });
      if (typeof hideStarter === 'function') hideStarter();
      document.getElementById('start-modal')?.classList.remove('show');
      document.getElementById('auth-overlay')?.classList.add('hidden');
      _newCreate(false); resetWorkplane(); setShapeMode('solid');
      fitView();
    });
  },

  scenes: [
    // ── 1: Hohlkörper ──
    {
      kapitel: '1 · Box anlegen',
      say: 'Schritt eins. Körper hinzufügen, Box. Länge sechzig, Tiefe achtzig, Höhe fünfunddreißig Millimeter. Die schmale Seite zeigt nach vorne.',
      run: async (v) => {
        await schild(v, 1, 'Box <b>60 × 80 × 35 mm</b> · schmale Stirnseite vorne');
        await neueBox(v);
        await masse(v, 60, 80, 35);
        await blick(v);
      },
    },
    {
      kapitel: '1 · Cutter',
      say: 'Jetzt oben rechts auf Cutter umschalten — alles, was jetzt kommt, wird ein Loch. Dann noch eine Box: vierundfünfzig, vierundsiebzig, dreiunddreißig. Das wird der Innenraum. Danach wieder zurück auf Solid.',
      run: async (v) => {
        await schild(v, 1, 'Auf <b>○ Cutter</b> umschalten · Box <b>54 × 74 × 33 mm</b>');
        await v.click('#mb-h', { after: 600 });
        await neueBox(v);
        await masse(v, 54, 74, 33);
        await v.click('#mb-s', { after: 300 });
        await blick(v);
      },
    },
    {
      kapitel: '1 · Ausrichten',
      say: 'Beide auswählen, Ausrichten. Horizontal mittig, Tiefe mittig, und oben. So sitzt der Innenraum genau in der Box, oben offen.',
      run: async (v) => {
        await schild(v, 1, 'Beide wählen → Ausrichten: <b>mittig, mittig, oben</b>');
        await alleWaehlen(v);
        await ausrichten(v, ['Horizontal mittig', 'Tiefe mittig', 'Oben']);
      },
    },
    {
      kapitel: '1 · Abziehen',
      say: 'Abziehen. Fertig ist der Hohlkörper: zwei Millimeter Boden, drei Millimeter Wand.',
      run: async (v) => {
        await schild(v, 1, '<b>⊖ Abziehen</b> → Hohlkörper');
        await abziehen(v);
        await schwenk(v, 0.75, 0.6, 1400);
      },
    },

    // ── 2: Nut ──
    {
      kapitel: '2 · Arbeitsebene',
      say: 'Schritt zwei, die Nut für den Deckel. Taste P, dann auf die Oberseite der Box klicken. Das ist jetzt die Arbeitsebene. Versatz minus fünf Komma vier.',
      run: async (v) => {
        await schild(v, 2, 'Nut: <b>Arbeitsebene</b> auf die Oberseite · Versatz <b>−5,4 mm</b>');
        await taste(v, 'P');
        await v.page.keyboard.press('p');
        await v.sleep(700);
        await taste(v, '');
        await v.clickAt(await oberseite(v, 0, true), { moveMs: 700, after: 900 });
        await v.type('#wp-off', '-5.4', { delay: 140 });
        await v.eval(() => { const e = document.getElementById('wp-off'); e.dispatchEvent(new Event('input')); });
        await v.sleep(600);
      },
    },
    {
      kapitel: '2 · Nut',
      say: 'Wieder auf Cutter, und eine Box sechsundfünfzig, achtundsiebzig, drei Komma vier. Sie liegt automatisch auf der Arbeitsebene — also genau dort, wo die Nut hin soll.',
      run: async (v) => {
        await schild(v, 2, '<b>○ Cutter</b> · Box <b>56 × 78 × 3,4 mm</b>');
        await v.click('#mb-h', { after: 500 });
        await neueBox(v);
        await masse(v, 56, 78, 3.4);
        await v.click('#mb-s', { after: 300 });
        await blick(v);
      },
    },
    {
      kapitel: '2 · Vorne ausrichten',
      say: 'Mit der Box ausrichten: horizontal mittig und vorne. So ist die Nut vorne offen und läuft links, rechts und hinten je einen Millimeter in die Wand.',
      run: async (v) => {
        await schild(v, 2, 'Mit der Box: <b>mittig + Vorne</b> → Nut links, rechts, hinten');
        await alleWaehlen(v);
        await ausrichten(v, ['Horizontal mittig', 'Vorne']);
        await v.eval(() => resetWorkplane());
      },
    },
    {
      kapitel: '2 · Abziehen',
      say: 'Abziehen. Wir drehen auf die offene Stirnseite: Da ist der Schlitz, in den der Deckel geschoben wird.',
      run: async (v) => {
        await schild(v, 2, '<b>⊖ Abziehen</b> → Nut fertig');
        await abziehen(v);
        await blick(v);
        await v.eval(() => { sph.r *= 0.8; sph2cam(); });
        await schwenk(v, 1.15, Math.PI - 0.45, 2200);   // offene Stirnseite liegt bei −z
      },
    },
    {
      kapitel: '3 · Griffkante (optional)',
      say: 'Schritt drei ist freiwillig: eine Griffkante vorne. Gleicher Weg, Versatz minus zwei, Cutter sechsundfünfzig mal fünf mal vier. Wir lassen sie hier weg.',
      run: async (v) => {
        await schild(v, 3, '<b>Optional – Griffkante:</b> Versatz −2 mm · Cutter 56 × 5 × 4 mm · mittig + Vorne', true);
        await v.sleep(800);
      },
    },

    // ── 4: Deckel ──
    {
      kapitel: '4 · Deckel',
      say: 'Schritt vier, der Deckel. Wir sind auf Solid, also eine neue Box: sechsundfünfzig, achtundsiebzig, drei Komma vier — genau so groß wie die Nut. V3D CAD stellt sie neben die Box.',
      run: async (v) => {
        await schild(v, 4, 'Deckel: Box <b>56 × 78 × 3,4 mm</b>');
        await schwenk(v, 0.9, 0.6, 900);
        await neueBox(v);
        await masse(v, 56, 78, 3.4);
        await v.eval(() => selectObjs([]));
        await blick(v);
      },
    },
    {
      kapitel: '4 · Spielraum',
      say: 'Damit er auch gleitet: Spielraum minus null Komma zwei. Der Deckel wird ringsum zwei Zehntel kleiner.',
      run: async (v) => {
        await schild(v, 4, '<b>⧈ Spielraum −0,2 mm</b> → 55,6 × 77,6 × 3 mm');
        await v.clickAt(await oberseite(v, 1), { moveMs: 700, after: 500 });
        await v.until(() => selectedObjs.length === 1 && selectedObjs[0] === objects[1], { timeout: 5000, msg: 'Deckel gewählt' });
        await v.click('button[onclick="openOffsetTool()"]', { after: 700 });
        await v.click('button[onclick="_offsetApply(-0.2)"]', { after: 1200 });
        await v.click('#offset-panel span[onclick="_offsetClose()"]', { after: 300 });
        await v.eval(() => selectObjs([]));
        await blick(v);
      },
    },
    {
      kapitel: '4 · Name',
      say: 'Jetzt der Name. Text, Namen eintippen, Auf Bauteil, Erstellen, und auf den Deckel klicken. Vertieft lassen, Anbringen.',
      run: async (v) => {
        await schild(v, 4, 'Name als <b>Text vertieft</b>');
        await v.eval(() => { addTextShape(); });
        await v.sleep(600);
        await v.type('#text3d-input', 'Lena', { delay: 150 });
        await v.eval(() => { const r = document.getElementById('text3d-size'); r.value = 12; r.dispatchEvent(new Event('input')); });
        await v.click('#text3d-modal button[onclick="_text3dSetMode(\'surface\')"]', { after: 400 });
        await v.click('#text3d-ok', { after: 900 });
        await v.until(() => !!_lblPick, { timeout: 20000, msg: 'Text wartet auf Bauteil' });
        await blick(v);
        await v.sleep(400);
        const p = await v.eval(() => {
          const L = objects[1];   // Deckel (0 = Box, 2 = Schriftzug)
          const x = new THREE.Box3().setFromObject(L), cv = renderer.domElement, r = cv.getBoundingClientRect();
          const q = new THREE.Vector3((x.min.x + x.max.x) / 2, x.max.y, (x.min.z + x.max.z) / 2).project(camera);
          return { x: r.left + (q.x + 1) / 2 * r.width, y: r.top + (1 - q.y) / 2 * r.height };
        });
        await v.clickAt(p, { moveMs: 800, after: 900 });
        await v.click('#lbl-tief', { after: 400 });
        await v.click('#lbl-pop button:has-text("Anbringen")', { after: 300 });
        await v.until(() => !objects.some((o) => o.userData.shapeType === 'svg'), { timeout: 60000, msg: 'Name angebracht' });
        await v.eval(() => selectObjs([]));
        await v.sleep(500);
      },
    },

    // ── 5: Prüfen ──
    {
      kapitel: '5 · Schnitt',
      say: 'Schritt fünf: prüfen. Die Schnittansicht schneidet das Modell nur zum Anschauen auf. Mit dem Regler schiebst du die Ebene durch — man sieht Boden, Wand und Nut.',
      run: async (v) => {
        await schild(v, 5, '<b>◪ Schnitt</b> prüfen');
        await v.eval(() => { fitView(); sph.phi = 1.05; sph.theta = Math.PI - 0.5; sph2cam(); });
        await v.click('#btn-section', { after: 500 });
        await v.click('#sec-ax-x', { after: 500 });
        await v.slider('#sec-slider', 700, { ms: 1400 });
        await v.sleep(1500);
        await v.click('#section-panel span[onclick="_secClose()"]', { after: 300 });
      },
    },
    {
      kapitel: '5 · Druck-Check',
      say: 'Dann der Druck-Check, und ab in den Slicer: Box offen nach oben, ohne Stützen.',
      run: async (v) => {
        await schild(v, 5, '<b>Druck-Check</b> → slicen: offen nach oben, <b>ohne Stützen</b>');
        await v.eval(() => _printCheckOpen());
        await v.sleep(2800);
        await v.page.keyboard.press('Escape');
        await v.eval(() => { document.querySelectorAll('.modal.show').forEach((m) => m.classList.remove('show')); });
        await schild(v, 0, '');
        await blick(v);
        await v.sleep(500);
      },
    },
  ],
};
