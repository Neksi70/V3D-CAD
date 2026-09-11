/* Howto: SVG-Motive auf einen Körper setzen — heften, verschieben, drehen, wickeln.
 *
 * Entstanden aus den Rückfragen von Josy (9.–11.9.2026): Das Aufsetzen selbst ist
 * schnell erklärt, die Stolpersteine liegen danach — genau positionieren, gerade
 * stellen, wieder abnehmen. Deshalb bekommt jeder dieser Schritte eine Szene.
 */
const SVG = new URL('../assets/baum.svg', import.meta.url).pathname;

/** Weltpunkt der Szene → Bildschirmposition (die 3D-Ansicht kennt keine Selektoren). */
const welt = (v, p) =>
  v.eval((p) => {
    const q = new THREE.Vector3(p[0], p[1], p[2]).project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return { x: r.left + (q.x * 0.5 + 0.5) * r.width, y: r.top + (-q.y * 0.5 + 0.5) * r.height };
  }, p);

/** Bildschirmpunkt der Motivmitte. */
const motiv = (v) =>
  v.eval(() => {
    const m = objects.find((o) => o.userData.shapeType === 'svg');
    const q = _svgCenterWorld(m).project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return { x: r.left + (q.x * 0.5 + 0.5) * r.width, y: r.top + (-q.y * 0.5 + 0.5) * r.height };
  });

/**
 * Punkt, an dem der Klick wirklich das Motiv trifft. Frisch importiert liegt es
 * flach auf der Platte und erscheint aus schräger Sicht nur als schmaler Streifen —
 * die reine Mitte geht dann ins Leere.
 */
const greif = (v) =>
  v.eval(() => {
    const m = objects.find((o) => o.userData.shapeType === 'svg');
    const q = _svgCenterWorld(m).project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    const bx = r.left + (q.x * 0.5 + 0.5) * r.width, by = r.top + (-q.y * 0.5 + 0.5) * r.height;
    const cv = renderer.domElement;
    for (let d = 0; d <= 70; d += 4)
      for (const [ox, oy] of [[0,0],[d,0],[-d,0],[0,d],[0,-d],[d,d],[-d,-d],[d,-d],[-d,d]]) {
        const x = bx + ox, y = by + oy;
        // Über dem Motiv liegen die Maß-Anfasser als eigene DOM-Elemente. Wer dort
        // anfasst, zieht die GRÖSSE statt das Teil — im Video wurde das Motiv so
        // plattgedrückt. Also nur Punkte nehmen, an denen die 3D-Fläche oben liegt.
        if (document.elementFromPoint(x, y) !== cv) continue;
        const hits = pickObjects({ clientX: x, clientY: y });
        if (!hits.length) continue;
        let p = hits[0].object;
        while (p && !objects.includes(p)) p = p.parent;
        if (p === m) return { x, y };
      }
    return { x: bx, y: by };
  });

/**
 * Bildschirmpunkt, an dem der Zeiger wirklich auf dem gewünschten Körper landet.
 * Sicherer als den Weltpunkt zu projizieren: getroffen werden muss die Fläche,
 * nicht eine Stelle, die rechnerisch davor liegt.
 */
const zielAuf = (v, name, dx = 0, dy = 0) =>
  v.eval(([name, dx, dy]) => {
    const t = objects.find((o) => o.userData.name === name);
    const c = new THREE.Box3().setFromObject(t).getCenter(new THREE.Vector3()).project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    const bx = r.left + (c.x * 0.5 + 0.5) * r.width + dx;
    const by = r.top + (-c.y * 0.5 + 0.5) * r.height + dy;
    const cv = renderer.domElement;
    for (let d = 0; d <= 120; d += 5)
      for (const [ox, oy] of [[0,0],[d,0],[-d,0],[0,d],[0,-d],[d,d],[-d,-d],[d,-d],[-d,d]]) {
        const x = bx + ox, y = by + oy;
        if (document.elementFromPoint(x, y) !== cv) continue;
        const hits = pickObjects({ clientX: x, clientY: y });
        if (!hits.length) continue;
        let p = hits[0].object;
        while (p && !objects.includes(p)) p = p.parent;
        if (p === t) return { x, y };
      }
    return { x: bx, y: by };
  }, [name, dx, dy]);

/** Sichtbar ziehen: Zeiger führen, Taste halten, in Schritten wandern. */
async function zieh(v, von, nach, ms = 1300) {
  await v.eval(() => selectObjs([]));   // Anfasser aus dem Weg; der Zug wählt selbst aus
  await v.moveTo(von, 480);
  await v.page.mouse.down();
  await v.eval(([x, y, d]) => window.__vid.glide(x, y, d), [nach.x, nach.y, ms]);
  const N = 26;
  for (let i = 1; i <= N; i++) {
    await v.page.mouse.move(von.x + (nach.x - von.x) * i / N, von.y + (nach.y - von.y) * i / N);
    await v.sleep(ms / N);
  }
  await v.page.mouse.up();
  await v.sleep(320);
}

/**
 * Im Bogen um die Motivmitte ziehen (Drehen auf der Fläche). Angefasst wird am
 * Motiv selbst — greift man daneben, zieht man den Körper darunter.
 */
async function drehe(v, mitte, start, grad, ms = 1600) {
  const r = Math.max(60, Math.hypot(start.x - mitte.x, start.y - mitte.y));
  const a0 = Math.atan2(start.y - mitte.y, start.x - mitte.x);
  const pt = (g) => ({ x: mitte.x + Math.cos(a0 + g * Math.PI / 180) * r,
                       y: mitte.y + Math.sin(a0 + g * Math.PI / 180) * r });
  await v.moveTo(start, 480);
  await v.page.mouse.down();
  const N = 26;
  for (let i = 1; i <= N; i++) {
    const p = pt(grad * i / N);
    await v.eval(([x, y, d]) => window.__vid.glide(x, y, d), [p.x, p.y, ms / N]);
    await v.page.mouse.move(p.x, p.y);
    await v.sleep(ms / N);
  }
  await v.page.mouse.up();
  await v.sleep(320);
}

export default {
  id: 'svg-aufsetzen',
  modal: 'svg-modal',
  hdrSel: '#svg-modal-hdr',
  title: 'Motive auf einen Körper setzen',
  subtitle: 'Heften, verschieben, gerade stellen, um Rundungen wickeln',
  icon: '📐',

  introText:
    'Moin! Du hast ein Motiv als SVG und möchtest es sauber auf ein Bauteil ' +
    'bekommen — mittig, gerade und genau da, wo du es haben willst. ' +
    'Genau das machen wir jetzt, Schritt für Schritt.',

  outroTitle: 'Fertig aufgesetzt!',
  outroText:
    'Das war alles: hinziehen zum Heften, nochmal ziehen zum genauen ' +
    'Positionieren, im Dreh-Modus gerade stellen — und wegziehen, wenn es ' +
    'wieder herunter soll. Viel Spaß beim Gravieren!',

  tags: ['svg', 'gravur', 'motiv', 'windlicht'],

  // Dieses Video arbeitet in der freien Ansicht, nicht in einem Generator —
  // die Vorlagen-Galerie muss deshalb zuerst aus dem Weg.
  async ready(v) {
    await v.eval(() => {
      if (typeof hideStarter === 'function') hideStarter();
      document.getElementById('start-modal')?.classList.remove('show');
      document.getElementById('auth-overlay')?.classList.add('hidden');
    });
  },

  scenes: [
    {
      kapitel: 'Motiv einfügen',
      say:
        'Zuerst brauchen wir einen Körper und das Motiv. Der Quader steht schon ' +
        'da; das SVG kommt über Formen, SVG importieren dazu. Im Dialog stellst ' +
        'du die Größe und die Dicke ein und bestätigst mit Einfügen.',
      run: async (v) => {
        await v.eval(() => {
          addShape('box');
          const box = objects[objects.length - 1];
          box.scale.set(4, 4, 2); box.position.set(0, 4, 0); box.userData.name = 'Quader';
          objects.forEach((o) => o.updateMatrixWorld(true));
          selectObjs([]);
        });
        await v.sleep(400);
        await v.eval((svgText) => {
          const m = _importSvgConfirm({ svgText, mode: 'extrude', depthMM: 3, targetMM: 55, name: 'Baum' });
          m.position.set(0, 0.2, 9);
          // kräftige Farbe: im Video soll man das Motiv auf dem Körper sofort sehen
          m.userData.color = '#F97316';
          if (m.material && m.material.color) m.material.color.set('#F97316');
          objects.forEach((o) => o.updateMatrixWorld(true));
          selectObjs([]);
          fitView();                      // Kamera von der App einpassen lassen
          sph.phi = 1.0; sph2cam(); camera.updateMatrixWorld(true);
        }, await (await import('node:fs/promises')).readFile(SVG, 'utf8'));
        await v.sleep(500);
      },
    },
    {
      kapitel: 'Auf die Fläche heften',
      say:
        'Jetzt fasst du das Motiv an und ziehst es auf die Stelle, wo es hin ' +
        'soll. Warte kurz, bis am Zeiger der Hinweis „Auf Fläche heften" ' +
        'erscheint — erst dann loslassen. Das Motiv legt sich flach auf die ' +
        'Wand, zunächst genau in deren Mitte.',
      run: async (v) => {
        await zieh(v, await greif(v), await zielAuf(v, 'Quader'), 1700);
        await v.sleep(600);
      },
    },
    {
      kapitel: 'Genau positionieren',
      say:
        'Fasst du es nochmal an, gleitet es auf der Fläche entlang und bleibt ' +
        'dabei sauber aufgesetzt. Am Zeiger siehst du in Millimetern, wie weit ' +
        'du von der Mitte weg bist — und in der Nähe der Mitte rastet es ein. ' +
        'Über die Kante schiebt es sich nicht hinaus, solange es auf die Fläche ' +
        'passt. So kannst du in Ruhe suchen, bis die Stelle stimmt: hinziehen, ' +
        'schauen, nachkorrigieren. Der Abstand zur Wand bleibt dabei immer ' +
        'gleich, die Gravur wird also später überall gleich tief.',
      run: async (v) => {
        await v.eval(() => { const m = objects.find((o) => o.userData.shapeType === 'svg'); selectObjs([m]); });
        await zieh(v, await greif(v), await zielAuf(v, 'Quader', -90, -70), 1500);
        await zieh(v, await greif(v), await zielAuf(v, 'Quader', 6, 4), 1500);
        await v.sleep(400);
      },
    },
    {
      kapitel: 'Gerade stellen',
      say:
        'Zum Drehen schaltest du oben auf Drehen um. Dann fasst du das Motiv an ' +
        'und ziehst im Bogen — es dreht sich flach auf der Fläche, ohne ' +
        'abzuheben. Hältst du dabei die Umschalttaste, rastet es in ' +
        'Fünfzehn-Grad-Schritten ein — praktisch, wenn etwas exakt gerade oder ' +
        'exakt über Eck stehen soll. Das Motiv bleibt dabei die ganze Zeit an ' +
        'der Wand kleben und fällt nicht auf die Druckplatte. Danach schaltest ' +
        'du wieder zurück auf Verschieben.',
      run: async (v) => {
        await v.eval(() => selectObjs([]));
        const mitte = await motiv(v);
        const anfasser = await greif(v);          // im Dreh-Modus liegen die Ringe darüber
        await v.eval(() => setMode('rotate'));
        await v.sleep(400);
        await drehe(v, mitte, anfasser, 28, 1700);
        await v.sleep(200);
        await drehe(v, mitte, await greif(v), -26, 1200);
        await v.eval(() => setMode('move'));
        await v.sleep(300);
      },
    },
    {
      kapitel: 'Mittig setzen',
      say:
        'Soll es exakt in die Mitte, gibt es unten links in der Werkzeugleiste ' +
        'den Knopf mit dem Kreuz im Kreis. Ein Klick, und das Motiv sitzt ' +
        'mittig auf seiner Fläche.',
      run: async (v) => {
        await v.eval(() => { const m = objects.find((o) => o.userData.shapeType === 'svg'); selectObjs([m]); });
        await zieh(v, await greif(v), await zielAuf(v, 'Quader', -95, -80), 1200);
        const knopf = await v.eval(() => {
          const m = objects.find((o) => o.userData.shapeType === 'svg');
          selectObjs([m]); updateCtxPopup();
          const b = document.getElementById('ctx-svgcenter');
          const r = b.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width),
                   disp: b.style.display, sel: selectedObjs.length,
                   snapN: !!m.userData._snapNormal, wrap: !!m.userData._svgWrap };
        });
        v.log('⊕-Knopf: ' + JSON.stringify(knopf));
        await v.sleep(250);
        // Auf Sichtbarkeit warten würde die Szene sprengen, wenn die Leiste noch
        // nachzieht — deshalb direkt auf die Position klicken.
        if (knopf.w > 0) { await v.spot('#ctx-svgcenter').catch(() => {}); await v.clickAt(knopf); }
        else await v.eval(() => svgCenterOnFace());
        await v.unspot().catch(() => {});
        await v.sleep(600);
      },
    },
    {
      kapitel: 'Um eine Rundung wickeln',
      say:
        'Auf einem runden Körper ist der Ablauf derselbe — nur heißt der Hinweis ' +
        'dann „Um Rundung wickeln". Das Motiv wird wirklich gebogen, damit die ' +
        'Gravur später überall gleich tief wird. Ziehen dreht es jetzt um den ' +
        'Körper herum und schiebt es in der Höhe.',
      run: async (v) => {
        await v.eval(() => {
          addShape('tube');
          const t = objects[objects.length - 1];
          t.scale.set(3, 4, 3); t.position.set(11, 4, 0); t.userData.name = 'Rohr';
          objects.forEach((o) => o.updateMatrixWorld(true));
          fitView(); sph.phi = 1.05; sph2cam(); camera.updateMatrixWorld(true);
          const m = objects.find((o) => o.userData.shapeType === 'svg'); selectObjs([m]);
        });
        await v.sleep(400);
        await zieh(v, await greif(v), await zielAuf(v, 'Rohr'), 1800);
        await v.sleep(500);
        await zieh(v, await greif(v), await zielAuf(v, 'Rohr', -55, -75), 1400);
        await v.sleep(400);
      },
    },
    {
      kapitel: 'Wieder abnehmen',
      say:
        'Und wenn es doch woanders hin soll: einfach deutlich neben den Körper ' +
        'ziehen. Dann löst es sich und liegt wieder flach vor dir — bereit für ' +
        'die nächste Stelle. Mit gedrückter Alt-Taste bewegst du es ganz frei, ' +
        'ohne dass es sich irgendwo anheftet.',
      run: async (v) => {
        await v.eval(() => { const m = objects.find((o) => o.userData.shapeType === 'svg'); selectObjs([m]); });
        await zieh(v, await greif(v), await zielAuf(v, 'Quader', -260, -150), 1600);
        await v.sleep(500);
        await v.orbit({ dx: 220, dy: -40, ms: 1500 });
      },
    },
  ],
};
