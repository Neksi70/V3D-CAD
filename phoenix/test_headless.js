// Headless-Test fuer den Phoenix-Nachbau: laedt die Seite vom laufenden Dienst
// und prueft Wellenaufbau, Kollisionen, Punkte und Fehlerfreiheit.
// Aufruf:  node /home/v3da/phoenix/test_headless.js
const { chromium } = require('/home/v3da/node_modules/playwright');

const URL = 'http://127.0.0.1:8768/';
let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window._pxdbg, null, { timeout: 8000 });

  // Testhelfer: Schiff unter ein Ziel fuehren und dauerfeuern (wie ein Spieler),
  // bzw. ein Geschoss gezielt direkt unter einem Ziel einsetzen.
  await page.evaluate(() => {
    window._t = {
      aim: function (getX, frames, stop) {
        const G = _pxdbg.G;
        for (let i = 0; i < frames; i++) {
          const tx = getX();
          if (tx != null) G.ship.x = Math.max(2, Math.min(208 - 16, tx - 6.5));
          _pxdbg.press('fire', true);
          _pxdbg.tick(1);
          if (stop && stop()) break;
        }
        _pxdbg.press('fire', false);
      },
      shootAt: function (cx, cy, ticks) {          // Geschoss direkt unter das Ziel setzen
        _pxdbg.G.shots.length = 0;
        _pxdbg.G.shots.push({ x: cx, y: cy });
        _pxdbg.tick(ticks || 4);
      }
    };
  });

  // --- Attract-Modus
  let s = await page.evaluate(() => _pxdbg.snap());
  check('Attract-Modus aktiv', s.state === 'ATTRACT', s.state);

  // --- Spielstart, Welle 1
  await page.evaluate(() => { _pxdbg.start(); _pxdbg.G.invuln = true; });
  s = await page.evaluate(() => { _pxdbg.tick(200); return _pxdbg.snap(); });
  check('Welle 1 laeuft', s.state === 'PLAY' && s.kind === 0, s);
  check('16 kleine Phoenixe im Schwarm', s.birds === 16, s.birds);
  check('3 Leben', s.lives === 3, s.lives);

  // --- Treffer auf einen Vogel in Formation = 20 Punkte (Original-Wert)
  const hit = await page.evaluate(() => {
    const G = _pxdbg.G;
    G.flock.diveT = 100000;                       // keine Sturzfluege waehrend des Tests
    const b = G.birds.find(x => x.st === 'form');
    const before = G.score, n0 = G.birds.length;
    _t.shootAt(b.x + 5, b.y + 10, 3);
    return { scored: G.score - before, killed: n0 - G.birds.length };
  });
  check('Treffer toetet Vogel', hit.killed === 1, hit);
  check('Punkte fuer Formationsvogel = 20', hit.scored === 20, hit.scored);

  // --- Treffer auf einen stuerzenden Vogel = 40 bzw. 80 Punkte
  const divePts = await page.evaluate(() => {
    const G = _pxdbg.G;
    const b = G.birds.find(x => x.st === 'form');
    b.st = 'dive'; b.t = 0; b.y = 100; b.x = 8;   // abseits des Schwarms isolieren
    const before = G.score;
    _t.shootAt(b.x + 5, b.y + 10, 3);
    return G.score - before;
  });
  check('Punkte fuer Sturzflugvogel = 40', divePts === 40, divePts);

  // --- nur ein Geschoss gleichzeitig (wie im Original)
  const shots = await page.evaluate(() => {
    _pxdbg.G.shots.length = 0;
    _pxdbg.press('fire', true); _pxdbg.tick(3);
    const n = _pxdbg.G.shots.length; _pxdbg.press('fire', false); return n;
  });
  check('nur ein Geschoss gleichzeitig', shots === 1, shots);

  // --- Schild: 2 s aktiv, danach 5 s Sperre, kein Feuer waehrend des Schilds
  const sh = await page.evaluate(() => {
    const G = _pxdbg.G;
    G.ship.shieldT = 0; G.ship.cdT = 0; G.shots.length = 0;
    _pxdbg.press('shield', true); _pxdbg.tick(1); _pxdbg.press('shield', false);
    const on = G.ship.shieldT;
    _pxdbg.press('fire', true); _pxdbg.tick(2); _pxdbg.press('fire', false);
    const shotsWhileShielded = G.shots.length;
    _pxdbg.tick(121);
    return { on, cd: G.ship.cdT, shotsWhileShielded };
  });
  check('Schild 120 Frames (2 s)', sh.on === 120, sh.on);
  check('kein Feuer bei aktivem Schild', sh.shotsWhileShielded === 0, sh.shotsWhileShielded);
  // 121 Ticks nach Schildende sind bereits 3 Frames Sperre abgelaufen
  check('Sperre ~300 Frames (5 s)', sh.cd >= 294 && sh.cd <= 300, sh.cd);

  // --- Sturzfluege und Bomben
  const dives = await page.evaluate(() => {
    const G = _pxdbg.G;
    _pxdbg.goStage(0); G.invuln = true;
    let maxBombs = 0, diving = 0;
    for (let i = 0; i < 900; i++) {
      _pxdbg.tick(1);
      maxBombs = Math.max(maxBombs, G.bombs.length);
      diving = Math.max(diving, G.birds.filter(b => b.st === 'dive').length);
    }
    return { maxBombs, diving, flyaway: G.flock.flyawayDone };
  });
  check('Voegel stossen herab', dives.diving > 0, dives);
  check('Bomben werden geworfen', dives.maxBombs > 0, dives.maxBombs);
  check('Diagonal-Abflug (Bonuschance) ausgeloest', dives.flyaway === true);

  // --- Geheimbonus: 3 diagonal wegfliegende Phoenixe in 2 s = 200.000
  const bonus = await page.evaluate(() => {
    const G = _pxdbg.G;
    G.bonusGiven = false; G.bonusKills = [];
    const before = G.score;
    for (let k = 0; k < 3; k++) {
      const b = G.birds.filter(x => x.st !== 'enter')[0];
      b.st = 'flyaway'; b.t = 0;
      _t.shootAt(b.x + 5, b.y + 10, 3);
    }
    _pxdbg.tick(2);
    return G.score - before;
  });
  check('Geheimbonus 200000 vergeben', bonus >= 200000, bonus);

  // --- Welle 3: Eier schluepfen zu grossen Phoenixen
  await page.evaluate(() => { _pxdbg.goStage(2); _pxdbg.G.invuln = true; });
  s = await page.evaluate(() => _pxdbg.snap());
  check('Welle 3: 6 Eier', s.eggs === 6, s.eggs);
  const eggPts = await page.evaluate(() => {
    const G = _pxdbg.G;
    const e = G.eggs[0], before = G.score, n0 = G.eggs.length;
    _t.shootAt(e.x + 5, e.y + 14, 4);
    return { pts: G.score - before, killed: n0 - G.eggs.length };
  });
  check('Ei zerstoerbar', eggPts.killed === 1, eggPts);
  check('Punkte fuer Ei = 50', eggPts.pts === 50, eggPts.pts);

  const hatched = await page.evaluate(() => {
    for (let i = 0; i < 900; i++) _pxdbg.tick(1);
    return { eggs: _pxdbg.G.eggs.length, bigs: _pxdbg.G.bigs.length };
  });
  check('Eier schluepfen zu Grossvoegeln', hatched.bigs > 0, hatched);

  // --- Fluegel abschiessen, Nachwachsen, Koerpertreffer
  const big = await page.evaluate(() => {
    const G = _pxdbg.G;
    G.bigs.length = 1;                             // nur ein Ziel im Schussfeld
    G.eggs.length = 0;
    const b = G.bigs[0];
    b.st = 'roam'; b.baseY = 120; b.y = 120; b.wingL = true; b.wingR = true; b.wings = 2;
    _t.shootAt(b.x - 7, b.y + 20, 4);              // linker Fluegel
    const wingGone = !b.wingL;
    for (let i = 0; i < 245; i++) _pxdbg.tick(1);
    const regrown = b.wingL;

    const b2 = G.bigs[0];
    b2.st = 'roam'; b2.baseY = 120; b2.y = 120;
    const before = G.score, n0 = G.bigs.length;
    _t.shootAt(b2.x + 6, b2.y + 22, 4);            // Koerper
    return { wingGone, regrown, killed: n0 - G.bigs.length, pts: G.score - before };
  });
  check('Fluegeltreffer entfernt Fluegel', big.wingGone === true, big);
  check('Fluegel waechst nach', big.regrown === true, big);
  check('Koerpertreffer toetet Grossvogel', big.killed === 1, big);
  check('Grossvogel-Punkte 100..800', big.pts >= 100 && big.pts <= 800, big.pts);

  // --- Welle 5: Raumfestung
  await page.evaluate(() => { _pxdbg.goStage(4); _pxdbg.G.invuln = true; });
  s = await page.evaluate(() => _pxdbg.snap());
  check('Raumfestung vorhanden', !!s.fort && s.fort.cells > 200, s.fort);
  const fort = await page.evaluate(() => {
    const G = _pxdbg.G;
    const y0 = G.fort.y, c0 = G.fort.cells.reduce((a, r) => a + r.filter(Boolean).length, 0);
    let escorts = 0, alienAfter150 = null;
    _t.aim(() => G.fort && G.fort.x + 60, 400, () => {
      escorts = Math.max(escorts, G.birds.length);
      if (alienAfter150 === null && G.fort && G.fort.rot >= 150) alienAfter150 = G.fort.alien;
      return !G.fort;
    });
    if (!G.fort) return { gone: true };
    const c1 = G.fort.cells.reduce((a, r) => a + r.filter(Boolean).length, 0);
    return { sank: G.fort.y > y0, carved: c0 - c1, escorts: escorts,
             rotated: G.fort.rot > 0, alienAfter150: alienAfter150 };
  });
  check('Festung sinkt herab', fort.sank === true, fort);
  check('Huelle wird weggeschossen', fort.carved > 20, fort.carved);
  check('Schildbaender rotieren', fort.rotated === true);
  check('Begleit-Phoenixe greifen an', fort.escorts > 0, fort.escorts);
  // Die Baender muessen den Piloten erst einmal decken -- nach 150 Frames
  // Dauerfeuer auf eine feste Spalte darf er noch nicht tot sein.
  check('Schildbaender decken den Piloten anfangs', fort.alienAfter150 === true, fort.alienAfter150);

  const alien = await page.evaluate(() => {
    const G = _pxdbg.G;
    _pxdbg.goStage(4); G.invuln = true;            // frische Festung
    const before = G.score;
    // Bahn durch die Baender und die untere Huelle freiraeumen
    for (let r = 9; r < 18; r++) for (let c = 13; c <= 16; c++) G.fort.cells[r][c] = null;
    _t.aim(() => G.fort && G.fort.x + 15 * 4, 600, () => !G.fort || !G.fort.alien);
    const dead = !G.fort || !G.fort.alien;
    const pts = G.score - before;
    for (let i = 0; i < 500; i++) _pxdbg.tick(1);
    return { dead, pts, snap: _pxdbg.snap() };
  });
  check('Alien-Pilot abgeschossen (nach freier Bahn)', alien.dead === true, alien.dead);
  check('Festung 1000..9000 Punkte', alien.pts >= 1000 && alien.pts <= 9000, alien.pts);
  check('naechster Zyklus startet', alien.snap.stage === 5 && alien.snap.cycle === 1, alien.snap);

  // --- Extraleben bei 3.000 Punkten
  const extra = await page.evaluate(() => {
    const G = _pxdbg.G;
    _pxdbg.goStage(0); G.invuln = true;
    G.flock.diveT = 100000;
    _pxdbg.tick(220);                              // Formation einschwenken lassen
    G.score = 2990; G.nextBonus = 3000; G.lives = 3;
    const b = G.birds.find(x => x.st === 'form');
    _t.shootAt(b.x + 5, b.y + 10, 3);
    return { lives: G.lives, next: G.nextBonus, score: G.score };
  });
  check('Extraleben bei 3000 Punkten', extra.lives === 4, extra);

  // --- Spielertod / Game Over
  const dead = await page.evaluate(() => {
    const G = _pxdbg.G;
    _pxdbg.goStage(0);
    G.invuln = false; G.lives = 1; G.ship.shieldT = 0; G.ship.cdT = 0;
    G.bombs.push({ x: G.ship.x + 6, y: 205, vy: 2, vx: 0 });
    for (let i = 0; i < 200; i++) _pxdbg.tick(1);
    return { state: G.state, lives: G.lives };
  });
  check('Tod fuehrt zu GAME OVER', dead.state === 'GAMEOVER', dead);

  // --- Schild faengt eine Bombe ab
  const blocked = await page.evaluate(() => {
    const G = _pxdbg.G;
    _pxdbg.start(); _pxdbg.goStage(0);
    G.invuln = false; G.ship.shieldT = 120; G.ship.cdT = 0;
    G.bombs.push({ x: G.ship.x + 6, y: 205, vy: 2, vx: 0 });
    for (let i = 0; i < 30; i++) _pxdbg.tick(1);
    return { state: G.state, lives: G.lives };
  });
  check('Schild faengt Bombe ab', blocked.state === 'PLAY' && blocked.lives === 3, blocked);

  // --- Langlauf ueber alle Wellentypen, ohne Ausnahmen
  const soak = await page.evaluate(() => {
    _pxdbg.start();
    for (let stage = 0; stage < 11; stage++) {
      _pxdbg.goStage(stage);
      _pxdbg.G.invuln = true;
      for (let i = 0; i < 1500; i++) { _pxdbg.press('fire', i % 3 === 0); _pxdbg.tick(1); }
    }
    _pxdbg.press('fire', false);
    return _pxdbg.snap();
  });
  check('Langlauf ueber 11 Wellen ohne Absturz', !!soak.state, soak.state);

  // --- Bildschirmfotos
  await page.evaluate(() => { _pxdbg.G.state = 'ATTRACT'; _pxdbg.G.stateT = 0; });
  await page.waitForTimeout(250);
  await page.screenshot({ path: '/tmp/phoenix_attract.png' });
  await page.evaluate(() => { _pxdbg.start(); _pxdbg.G.invuln = true; _pxdbg.tick(300); });
  await page.waitForTimeout(250);
  await page.screenshot({ path: '/tmp/phoenix_wave1.png' });
  await page.evaluate(() => { _pxdbg.goStage(2); _pxdbg.G.invuln = true; _pxdbg.tick(800); });
  await page.waitForTimeout(250);
  await page.screenshot({ path: '/tmp/phoenix_bigbirds.png' });
  await page.evaluate(() => { _pxdbg.goStage(4); _pxdbg.G.invuln = true; _pxdbg.tick(900); });
  await page.waitForTimeout(250);
  await page.screenshot({ path: '/tmp/phoenix_fortress.png' });

  check('keine JS-Fehler', errors.length === 0, errors.slice(0, 5));

  await browser.close();
  console.log(fails === 0 ? '\nALLE TESTS OK' : '\n' + fails + ' TEST(S) FEHLGESCHLAGEN');
  process.exit(fails === 0 ? 0 : 1);
})();
