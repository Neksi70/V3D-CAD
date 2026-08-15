// Headless-Check fuer Ballast: Level-Integritaet + Physik-Kennzahlen + Grundmechanik.
// Aufruf:  node test_headless.js   (Server muss auf 8773 laufen)
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await page.goto('http://127.0.0.1:8773/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.evaluate(() => window._blDbg.pause());   // deterministisch: keine Frames nebenher

  const fail = [];
  const ok = m => console.log('  ok   ' + m);
  const bad = m => { console.log('  FAIL ' + m); fail.push(m); };

  // 1. Level-Raster
  const grid = await page.evaluate(() => window._blDbg.LEVELS.map((L, i) => ({
    i, name: L.name, mass: L.mass,
    rows: L.rows.length,
    badLen: L.rows.map((r, y) => ({ y, n: r.length })).filter(r => r.n !== 40),
    starts: L.rows.join('').split('S').length - 1,
    goals: L.rows.join('').split('Z').length - 1,
    platesA: (L.rows.join('').match(/[123]/g) || []).length,
    platesB: (L.rows.join('').match(/[456]/g) || []).length,
    doorsA: (L.rows.join('').match(/D/g) || []).length,
    doorsB: (L.rows.join('').match(/E/g) || []).length,
  })));
  for (const g of grid) {
    if (g.rows !== 18) bad(`Level ${g.i + 1} hat ${g.rows} Zeilen (erwartet 18)`);
    if (g.badLen.length) bad(`Level ${g.i + 1} Zeilenlaengen: ` + JSON.stringify(g.badLen));
    if (g.starts !== 1) bad(`Level ${g.i + 1}: ${g.starts} Startpunkte`);
    if (g.goals !== 1) bad(`Level ${g.i + 1}: ${g.goals} Ziele`);
    if (g.doorsA > 0 && g.platesA === 0) bad(`Level ${g.i + 1}: Tor A ohne Platte`);
    if (g.doorsB > 0 && g.platesB === 0) bad(`Level ${g.i + 1}: Tor B ohne Platte`);
    if (g.platesA > 0 && g.doorsA === 0) bad(`Level ${g.i + 1}: Platte A ohne Tor`);
    if (g.platesB > 0 && g.doorsB === 0) bad(`Level ${g.i + 1}: Platte B ohne Tor`);
    if (g.mass < 1 || g.mass > 6) bad(`Level ${g.i + 1}: Startmasse ${g.mass}`);
  }
  if (!fail.length) ok(`${grid.length} Level, Raster 40x18 sauber`);

  // 2. Physik-Kennzahlen: leichter = deutlich hoeher/weiter
  const phys = await page.evaluate(() => {
    const d = window._blDbg, o = [];
    for (let w = 1; w <= 6; w++) o.push({ w, h: d.jumpHeight(w), span: d.jumpSpan(w) });
    return o;
  });
  console.log('  Sprungtabelle (Gewicht -> Hoehe px / Weite px):');
  phys.forEach(p => console.log(`     ${p.w}: ${p.h}px hoch (${(p.h / 24).toFixed(1)} Kacheln), ${p.span}px weit (${(p.span / 24).toFixed(1)} Kacheln)`));
  if (!(phys[0].h > phys[5].h * 3)) bad('Gewicht wirkt zu schwach auf die Sprunghoehe');
  else ok('Gewicht spreizt die Sprunghoehe um Faktor ' + (phys[0].h / phys[5].h).toFixed(1));

  // 3. Abwerfen / Aufnehmen
  const drop = await page.evaluate(async () => {
    const d = window._blDbg;
    d.level(0);
    const before = d.state();
    d.key('drop', 1); d.step(2); d.key('drop', 0);
    d.step(200);                      // Klumpen faellt und kommt zur Ruhe
    const after = d.state();
    const wurfweite = Math.round(Math.abs(d.G.chunks[d.G.chunks.length - 1].x - d.G.player.x));
    // zum Aufnehmen muss man hin: mit Runter+Q direkt unter sich ablegen
    d.level(0);
    d.key('down', 1); d.key('drop', 1); d.step(2); d.key('drop', 0); d.key('down', 0);
    d.step(60);
    const abgelegt = d.state();
    d.key('pick', 1); d.step(2); d.key('pick', 0); d.step(4);
    const back = d.state();
    return { before, after, back, wurfweite, abgelegt };
  });
  if (drop.after.mass === drop.before.mass - 1 && drop.after.chunks === drop.before.chunks + 1)
    ok(`Abwerfen: Masse ${drop.before.mass} -> ${drop.after.mass}, Klumpen ${drop.before.chunks} -> ${drop.after.chunks}`);
  else bad('Abwerfen wirkt nicht: ' + JSON.stringify(drop));
  if (drop.wurfweite > 60) ok(`Wurf nach vorn traegt ${drop.wurfweite}px weit`);
  else bad('Wurfweite zu gering: ' + drop.wurfweite);
  if (drop.abgelegt.mass === drop.before.mass - 1 && drop.back.mass === drop.before.mass)
    ok('Runter+Q legt unter sich ab, E holt es zurueck');
  else bad('Ablegen/Aufnehmen fehlgeschlagen: ' + JSON.stringify([drop.abgelegt, drop.back]));

  // 4. Klumpen bleibt liegen (faellt nicht durch die Welt)
  const rest = await page.evaluate(() => {
    const d = window._blDbg;
    d.level(0);
    d.key('drop', 1); d.step(2); d.key('drop', 0); d.step(400);
    const c = d.G.chunks[0];
    return { y: Math.round(c.y), vy: Math.round(c.vy), rest: c.rest, boden: 16 * 24 - 20 };
  });
  if (rest.rest && Math.abs(rest.y - rest.boden) < 3) ok('Klumpen liegt stabil auf dem Boden (y=' + rest.y + ')');
  else bad('Klumpen ruht nicht korrekt: ' + JSON.stringify(rest));

  // 5. Druckplatte oeffnet Tuer erst mit genug Gewicht
  const plate = await page.evaluate(() => {
    const d = window._blDbg;
    d.level(4);                        // "Kaltes Gewicht", Platte mit Schwelle 2
    const pl = d.G.plates[0];
    const res = { need: pl.need, closedBefore: d.G.doorsOpen.A };
    d.step(60);
    res.oneChunk = null;
    // erst ein Klumpen (zu wenig), dann ein zweiter
    d.G.chunks.push({ x: pl.x * 24 + 2, y: pl.y * 24 - 20, vx: 0, vy: 0, w: 20, h: 20, rest: true, age: 0 });
    d.step(60);
    res.oneChunk = { load: d.G.plates[0].load, open: d.G.doorsOpen.A };
    d.G.chunks.push({ x: pl.x * 24 + 2, y: pl.y * 24 - 44, vx: 0, vy: 0, w: 20, h: 20, rest: false, age: 0 });
    d.step(120);
    res.load = d.G.plates[0].load;
    res.open = d.G.doorsOpen.A;
    return res;
  });
  if (!plate.closedBefore && !plate.oneChunk.open && plate.open && plate.load >= plate.need)
    ok(`Platte: 1 Klumpen = ${plate.oneChunk.load} (Tor zu), gestapelt = ${plate.load}/${plate.need} (Tor offen)`);
  else bad('Druckplatte/Tor stimmt nicht: ' + JSON.stringify(plate));

  // 6. Bruchboden nur mit Gewicht
  const brk = await page.evaluate(() => {
    const d = window._blDbg;
    const out = {};
    for (const m of [2, 5]) {
      d.level(2);                      // "Durchschlag", Bruchboden in Zeile 12
      const p = d.G.player;
      p.mass = m; p.x = 14 * 24; p.y = 8 * 24; p.vy = 0;
      d.step(400);
      out['masse' + m] = d.tile(14, 12);
    }
    return out;
  });
  if (brk.masse2 === '=' && brk.masse5 === '.') ok('Bruchboden: haelt bei Gewicht 2, bricht bei Gewicht 5');
  else bad('Bruchboden-Verhalten falsch: ' + JSON.stringify(brk));

  // 7. Aufwind traegt nur Leichtgewichte
  const wind = await page.evaluate(() => {
    const d = window._blDbg;
    const out = {};
    for (const m of [1, 6]) {
      d.level(3);                      // "Aufwind", Schacht bei x=11..14
      const p = d.G.player;
      p.mass = m; p.x = 12.5 * 24; p.y = 15 * 24; p.vy = 0; p.vx = 0;
      const y0 = p.y;
      d.step(180);
      out['masse' + m] = Math.round(y0 - p.y);
    }
    return out;
  });
  if (wind.masse1 > 100 && wind.masse6 < 20) ok(`Aufwind: Gewicht 1 steigt ${wind.masse1}px, Gewicht 6 nur ${wind.masse6}px`);
  else bad('Aufwind-Verhalten falsch: ' + JSON.stringify(wind));

  // 7b. Seitenwind: leicht wird zurueckgedrueckt, schwer kommt durch
  const side = await page.evaluate(() => {
    const d = window._blDbg;
    const out = {};
    for (const m of [1, 4]) {
      d.level(5);                      // "Gegenwind", Sturm bei x=10..23
      const p = d.G.player;
      p.mass = m; p.x = 12 * 24; p.y = 16 * 24; p.vx = 0; p.vy = 0;
      const x0 = p.x;
      d.key('right', 1); d.step(240); d.key('right', 0);
      out['masse' + m] = Math.round(p.x - x0);
    }
    return out;
  });
  if (side.masse1 < 0 && side.masse4 > 80) ok(`Sturm: Gewicht 1 verliert ${-side.masse1}px, Gewicht 4 macht ${side.masse4}px gut`);
  else bad('Seitenwind-Verhalten falsch: ' + JSON.stringify(side));

  // 8. Stacheln toeten
  const spike = await page.evaluate(() => {
    const d = window._blDbg;
    d.level(0);
    const p = d.G.player;
    p.x = 18 * 24; p.y = 15 * 24; p.vy = 200;
    d.step(120);
    return d.state().state;
  });
  if (spike === 'dead') ok('Stacheln toeten');
  else bad('Stacheln wirkungslos (state=' + spike + ')');

  // 9. Ziel loest Sieg aus
  const win = await page.evaluate(() => {
    const d = window._blDbg;
    d.level(0);
    const p = d.G.player;
    p.x = 33 * 24 + 12; p.y = 16 * 24; p.vy = 0;
    d.step(20);
    return d.state().state;
  });
  if (win === 'won') ok('Ziel loest Sieg aus');
  else bad('Ziel reagiert nicht (state=' + win + ')');

  // 9b. Steinbeisser: drei Interaktionen, alle am Gewicht haengend
  const bug = await page.evaluate(() => {
    const d = window._blDbg;
    const setup = mass => {
      d.level(2);                       // "Durchschlag" hat einen Steinbeisser bei x=29
      d.G.chunks.length = 0;
      const e = d.G.enemies[0], p = d.G.player;
      p.mass = mass; p.x = e.x + e.w / 2; p.y = e.y - 40; p.vx = 0; p.vy = 260;
      return { e, p };
    };
    const out = {};
    // schwer von oben: zertreten
    let s = setup(4); d.step(22);
    out.stomp = { enemy: s.e.alive, player: d.G.state, bounce: Math.round(d.G.player.vy) };
    // leicht von oben: verloren
    s = setup(2); d.step(60);
    out.tooLight = { enemy: s.e.alive, player: d.G.state };
    // seitlicher Kontakt toetet immer
    d.level(2); d.G.chunks.length = 0;
    const e2 = d.G.enemies[0], p2 = d.G.player;
    p2.mass = 6; p2.x = e2.x - 6; p2.y = e2.y + e2.h; p2.vx = 0; p2.vy = 0;
    d.step(40);
    out.side = d.G.state;
    // geworfener Klumpen zerschlaegt den Panzer
    d.level(2); d.G.chunks.length = 0;
    const e3 = d.G.enemies[0];
    d.G.player.x = 100; d.G.player.y = 12 * 24;
    d.G.chunks.push({ x: e3.x - 34, y: e3.y + e3.h - 20, vx: 320, vy: 0, w: 20, h: 20, rest: false, age: 0 });
    d.step(24);
    out.thrown = { enemy: e3.alive, player: d.G.state };
    // Patrouille: bleibt auf dem Podest und im Radius
    d.level(2);
    const e4 = d.G.enemies[0], x0 = e4.x;
    let min = x0, max = x0;
    for (let i = 0; i < 900; i++) { d.step(1); min = Math.min(min, e4.x); max = Math.max(max, e4.x); }
    out.patrol = { spanne: Math.round(max - min), y: Math.round(e4.y), lebt: e4.alive, boden: e4.grounded };
    return out;
  });
  if (!bug.stomp.enemy && bug.stomp.player === 'play' && bug.stomp.bounce < -40)
    ok(`Steinbeisser: mit Gewicht 4 zertreten (Abprall ${bug.stomp.bounce})`);
  else bad('Zertreten geht nicht: ' + JSON.stringify(bug.stomp));
  if (bug.tooLight.enemy && bug.tooLight.player === 'dead') ok('Zu leicht draufspringen ist toedlich');
  else bad('Leichtes Draufspringen falsch: ' + JSON.stringify(bug.tooLight));
  if (bug.side === 'dead') ok('Seitlicher Kontakt ist toedlich');
  else bad('Seitlicher Kontakt wirkungslos: ' + bug.side);
  if (!bug.thrown.enemy && bug.thrown.player === 'play') ok('Geworfener Klumpen zerschlaegt den Steinbeisser');
  else bad('Klumpenwurf wirkungslos: ' + JSON.stringify(bug.thrown));
  if (bug.patrol.lebt && bug.patrol.spanne > 30 && bug.patrol.spanne < 170 && bug.patrol.y < 12 * 24)
    ok(`Patrouille: ${bug.patrol.spanne}px hin und her, faellt nicht herunter`);
  else bad('Patrouille falsch: ' + JSON.stringify(bug.patrol));

  // 10. Machbarkeit der Schluesselstellen: echte Simulation mit Anlauf + Sprung
  await page.evaluate(() => {
    window._sim = o => {
      const d = window._blDbg;
      d.level(o.level);
      const p = d.G.player;
      p.mass = o.mass; p.x = o.fromX; p.y = o.fromY; p.vx = 0; p.vy = 0;
      if (o.clear) d.G.chunks.length = 0;
      (o.chunks || []).forEach(c => d.G.chunks.push({ x: c[0], y: c[1], vx: 0, vy: 0, w: 20, h: 20, rest: true, age: 0 }));
      const dir = o.dir > 0 ? 'right' : 'left';
      // jede Landung mitschreiben - der Endzustand allein sagt nichts, weil der
      // Testlaeufer die Laufrichtung haelt und ueber schmale Podeste hinauslaeuft
      const stands = [];
      let top = 1e9;
      const run = n => { for (let i = 0; i < n; i++) { d.step(1); top = Math.min(top, p.y); if (p.onGround) stands.push(Math.round(p.y) + '@' + Math.round(p.x)); } };
      if (o.dir) d.key(dir, 1);
      if (o.jumpAtX !== undefined) {
        for (let i = 0; i < 600; i++) { if (o.dir > 0 ? p.x >= o.jumpAtX : p.x <= o.jumpAtX) break; run(1); }
        d.key('jump', 1); run(2); run(o.hold || 90); d.key('jump', 0);
      }
      run(o.after || 200);
      if (o.dir) d.key(dir, 0);
      run(30);
      return {
        x: Math.round(p.x), y: Math.round(p.y), top: Math.round(top),
        state: d.G.state, alive: p.alive,
        levels: [...new Set(stands.map(s => Math.round(+s.split('@')[0])))].sort((a, b) => a - b),
      };
    };
  });
  const stood = (r, h) => r.levels.some(y => Math.abs(y - h) < 4);
  const feas = async (label, o, want) => {
    const r = await page.evaluate(o => window._sim(o), o);
    (want(r) ? ok : bad)(`${label}: Halt bei y=[${r.levels}] hoechster Punkt y=${r.top} (${r.state})`);
  };

  console.log('  Schluesselstellen:');
  // L1: Stachelgrube (x=15..22) nur als Federgewicht ueberspringbar
  await feas('L1 Grube mit Gewicht 1',
    { level: 0, mass: 1, fromX: 200, fromY: 384, dir: 1, jumpAtX: 15 * 24 - 6 },
    r => r.alive && r.x > 23 * 24);
  await feas('L1 Grube mit Gewicht 3 scheitert (erwartet)',
    { level: 0, mass: 3, fromX: 200, fromY: 384, dir: 1, jumpAtX: 15 * 24 - 6 },
    r => !r.alive || r.x < 23 * 24);

  // L2: Klumpen auf Stacheln traegt den Spieler
  await feas('L2 Klumpen deckt Stacheln ab',
    { level: 1, mass: 2, fromX: 12 * 24 + 10, fromY: 16 * 24 - 20, chunks: [[12 * 24 + 2, 16 * 24 - 20]], after: 120 },
    r => r.alive && stood(r, 16 * 24 - 20));
  await feas('L2 Stachelfeld ohne Steine unpassierbar (erwartet)',
    { level: 1, mass: 1, fromX: 150, fromY: 384, dir: 1, jumpAtX: 10 * 24 - 6 },
    r => !r.alive || r.x < 20 * 24);

  // L3: Aufstieg zu den beiden Klumpen
  await feas('L3 Podest 1 (72px) mit Gewicht 2',
    { level: 2, mass: 2, fromX: 11 * 24, fromY: 12 * 24, dir: 1, jumpAtX: 13 * 24, after: 60 },
    r => r.alive && stood(r, 9 * 24));
  await feas('L3 Podest 2 (72px) mit Gewicht 3',
    { level: 2, mass: 3, fromX: 15 * 24, fromY: 9 * 24, dir: 1, jumpAtX: 19 * 24, clear: true },
    r => r.alive && stood(r, 6 * 24));

  // L4: Aufwind traegt bis zur Ausstiegsplattform
  await feas('L4 Aufstieg + Ausstieg (Gewicht 1)',
    { level: 3, mass: 1, fromX: 12.5 * 24, fromY: 16 * 24, dir: 1, after: 420 },
    r => r.alive && (stood(r, 5 * 24) || stood(r, 4 * 24)));
  await feas('L4 Aufstieg mit Gewicht 2 reicht noch',
    { level: 3, mass: 2, fromX: 12.5 * 24, fromY: 16 * 24, dir: 1, after: 500 },
    r => r.alive && (stood(r, 5 * 24) || stood(r, 4 * 24)));
  await feas('L4 Aufstieg mit Gewicht 4 scheitert (erwartet)',
    { level: 3, mass: 4, fromX: 12.5 * 24, fromY: 16 * 24, dir: 0, after: 400 },
    r => r.top > 12 * 24);

  // L5: Bonus-Podest (168px) nur voellig entleert erreichbar
  await feas('L5 Podest (168px) mit Gewicht 1',
    { level: 4, mass: 1, fromX: 9 * 24, fromY: 16 * 24, dir: 1, jumpAtX: 11 * 24 },
    r => r.alive && stood(r, 10 * 24));

  // L6: Schlusssprung (144px) nach dem Sturm
  await feas('L6 Schlusssprung mit Gewicht 1',
    { level: 5, mass: 1, fromX: 29 * 24, fromY: 16 * 24, dir: 1, jumpAtX: 31 * 24 },
    r => r.alive && stood(r, 11 * 24));
  await feas('L6 Schlusssprung mit Gewicht 4 scheitert (erwartet)',
    { level: 5, mass: 4, fromX: 29 * 24, fromY: 16 * 24, dir: 1, jumpAtX: 31 * 24 },
    r => !stood(r, 11 * 24));

  // L7: Podeste in beiden Kammern (96px)
  await feas('L7 Podest Kammer A (angetippter Sprung)',
    { level: 6, mass: 2, fromX: 1.5 * 24, fromY: 16 * 24, dir: 1, jumpAtX: 2.5 * 24, hold: 30, clear: true },
    r => r.alive && stood(r, 13 * 24));
  await feas('L7 Podest Kammer B (angetippter Sprung)',
    { level: 6, mass: 2, fromX: 15 * 24, fromY: 16 * 24, dir: 1, jumpAtX: 16.5 * 24, hold: 30, clear: true },
    r => r.alive && stood(r, 13 * 24));

  // L8: Podest der oberen Etage + Durchbruch durch die Falltuer
  await feas('L8 Podest obere Etage mit Gewicht 1',
    { level: 7, mass: 1, fromX: 20 * 24, fromY: 5 * 24, dir: 1, jumpAtX: 21 * 24, clear: true, after: 40 },
    r => r.alive && stood(r, 4 * 24));
  const fin = await page.evaluate(() => {
    const d = window._blDbg;
    d.level(7);
    const p = d.G.player;
    // Platte mit einem Klumpen belegen -> Falltuer auf, dann mit Gewicht 4 hindurch
    const pl = d.G.plates[0];
    d.G.chunks.push({ x: pl.x * 24 + 2, y: pl.y * 24 - 20, vx: 0, vy: 0, w: 20, h: 20, rest: true, age: 0 });
    p.mass = 4; p.x = 28.4 * 24; p.y = 7 * 24; p.vx = 0; p.vy = 0;
    d.step(30);
    const open = d.G.doorsOpen.A;
    d.step(300);
    return { open, bruch: d.tile(28, 11), state: d.G.state, y: Math.round(p.y) };
  });
  if (fin.open && fin.bruch === '.' && fin.state === 'won')
    ok('L8 Falltuer offen, Bruchboden durchschlagen, Ziel erreicht');
  else bad('L8 Finale klemmt: ' + JSON.stringify(fin));

  // 11. Ablauf: Titel -> Kapitelkarte -> Spiel -> Sieg -> naechste Karte
  const flow = await page.evaluate(() => {
    const d = window._blDbg, out = {};
    d.G.state = 'title';
    out.start = d.G.state;
    d.advance(); out.nachTitel = d.G.state;                 // Kapitel 1 hat eine Karte
    out.karte = d.G.pending;
    d.advance(); out.imSpiel = d.G.state + '/' + d.G.li;
    d.G.state = 'won'; d.G.li = 0;
    d.advance(); out.nachSieg = d.G.state + '/' + d.G.li;   // Ebene 2 ohne Karte
    d.G.state = 'won'; d.G.li = 2;
    d.advance(); out.vorKapitel2 = d.G.state + '/' + d.G.pending;
    d.G.state = 'won'; d.G.li = 7;
    d.advance(); out.nachLetztem = d.G.state;
    return out;
  });
  const flowOk = flow.start === 'title' && flow.nachTitel === 'story' && flow.karte === 0 &&
    flow.imSpiel === 'play/0' && flow.nachSieg === 'play/1' &&
    flow.vorKapitel2 === 'story/3' && flow.nachLetztem === 'end';
  if (flowOk) ok('Ablauf Titel -> Kapitelkarte -> Ebene -> Sieg -> Abspann');
  else bad('Ablauf stimmt nicht: ' + JSON.stringify(flow));

  // 12. Musik laeuft nach einer echten Nutzergeste
  await page.evaluate(() => { window._blDbg.pause(false); window._blDbg.level(0); });
  await page.waitForTimeout(800);            // alte Respawn-Timer auslaufen lassen
  await page.keyboard.press('KeyM'); await page.keyboard.press('KeyM');
  await page.waitForTimeout(200);
  const m0 = await page.evaluate(() => ({ step: window._AUD.step, song: window._AUD.song }));
  await page.waitForTimeout(1000);
  const mus = await page.evaluate(() => ({
    song: window._AUD.song, laeuft: !!window._AUD.timer, step: window._AUD.step,
    an: window._AUD.music, kontext: window._actxState(),
  }));
  await page.evaluate(() => window._blDbg.pause());
  const takte = mus.step - m0.step;
  if (mus.kontext === 'running' && mus.laeuft && mus.song === m0.song && takte >= 2)
    ok(`Musik: Song "${mus.song}" laeuft, ${takte} Achtel in einer Sekunde geplant`);
  else bad('Musik laeuft nicht: ' + JSON.stringify({ m0, mus, takte }));

  if (errs.length) errs.forEach(e => bad(e));
  else ok('keine JS-Fehler');

  console.log(fail.length ? `\n${fail.length} FEHLER` : '\nAlles gruen');
  await browser.close();
  process.exit(fail.length ? 1 : 0);
})();
