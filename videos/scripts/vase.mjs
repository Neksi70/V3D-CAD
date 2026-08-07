/* Howto: Vasen-Generator.
 *
 * Die Vase hat mehr Regler als jeder andere Generator. Sie alle vorzuführen
 * wäre ermüdend — das Video zeigt deshalb die vier, die die Form wirklich
 * bestimmen (Bauch, Hals, Querschnitt, Oberfläche) und schließt mit dem
 * Punkt, an dem beim Drucken die meisten scheitern: der Wandstärke.
 */
export default {
  id: 'vase',
  modal: 'vase-modal',
  title: 'Vasen & Übertöpfe',
  subtitle: 'Eine eigene Form in zwei Minuten',
  icon: '🏺',

  introText:
    'Moin! Wir bauen eine Vase — und zwar keine aus dem Netz, sondern deine ' +
    'eigene Form, nur mit Schiebereglern.',

  outroTitle: 'Fertig zum Drucken!',
  outroText:
    'Das war der Vasen-Generator. Spiel ruhig mit den Reglern — zwei Klicks ' +
    'weiter sieht die Vase völlig anders aus.',

  tags: ['vase', 'deko'],

  scenes: [
    {
      kapitel: 'Generator öffnen',
      say: 'Die Vase liegt gleich vorn in der Vorlagen-Galerie.',
      at: '.st-card:has-text("Vase")',
      hold: 0.3,
      run: async (v) => {
        await v.click('.st-card:has-text("Vase")', { after: 1000 });
      },
    },
    {
      kapitel: 'Die Silhouette',
      say:
        'Links dreht sich die Vase live mit. Die obere Reglergruppe formt ihre ' +
        'Silhouette — jeder Regler zieht an einer Stelle der Kontur.',
      at: '#vase-canvas',
      pad: 10,
      hold: 0.7,
    },
    {
      kapitel: 'Bauch und Öffnung',
      say:
        'Der Bauch macht sie rund und satt, die Öffnung bestimmt, wie weit sie ' +
        'oben aufgeht. Schon diese zwei geben ihr den Charakter.',
      at: '#vp-belly',
      run: async (v) => {
        await v.slider('#vp-belly', 62, { ms: 1100 });
        await v.sleep(600);
        await v.spot('#vp-top');
        await v.slider('#vp-top', 40, { ms: 900 });
        await v.sleep(600);
      },
    },
    {
      kapitel: 'Hals',
      say:
        'Mit Hals und Hals-Position ziehst du die Taille nach oben oder unten. ' +
        'Eine schmale Taille wirkt gleich viel eleganter.',
      at: '#vp-neck',
      run: async (v) => {
        await v.slider('#vp-neck', 34, { ms: 1000 });
        await v.sleep(500);
        await v.spot('#vp-neckh');
        await v.slider('#vp-neckh', 68, { ms: 900 });
        await v.sleep(600);
      },
    },
    {
      kapitel: 'Höhe und Breite',
      say: 'Höhe und Breite sind die echten Maße in Millimetern.',
      at: '#vp-h',
      run: async (v) => {
        await v.slider('#vp-h', 180, { ms: 1000 });
        await v.sleep(500);
      },
    },
    {
      kapitel: 'Querschnitt',
      say:
        'Jetzt wird es interessant: Der Querschnitt muss kein Kreis sein. ' +
        'Ein Vieleck oder eine Welle machen aus derselben Silhouette eine ' +
        'völlig andere Vase.',
      at: '#vbg-cross',
      pad: 6,
      run: async (v) => {
        await v.click('#vbg-cross .vtb:nth-child(5)', { after: 1500 });
        await v.click('#vbg-cross .vtb:nth-child(4)', { after: 1500 });
      },
    },
    {
      kapitel: 'Oberfläche',
      say:
        'Dazu die Oberfläche: Rillen fangen das Licht, Low Poly gibt ihr ' +
        'Facetten, Organisch lässt sie handgetöpfert wirken.',
      at: '#vbg-surf',
      pad: 6,
      run: async (v) => {
        await v.click('#vbg-surf .vtb:nth-child(3)', { after: 1400 });
        await v.click('#vbg-surf .vtb:nth-child(2)', { after: 1400 });
      },
    },
    {
      kapitel: 'Verdrehen',
      say:
        'Und mit dem Verdrehen wird aus den Kanten eine Spirale — das ist der ' +
        'Regler, der am meisten hermacht.',
      at: '#vp-twist',
      run: async (v) => {
        await v.slider('#vp-twist', 90, { ms: 1400 });
        await v.sleep(900);
      },
    },
    {
      kapitel: 'Wandstärke — wichtig fürs Drucken',
      say:
        'Ein Wort zur Wandstärke: Wenn du im Slicer den Vasenmodus benutzt, ' +
        'druckt der Drucker eine einzige Linie in einer Spirale. Dann sollte ' +
        'die Wand hier ungefähr so dick sein wie deine Düse breit ist.',
      at: '#vp-wall',
      run: async (v) => {
        await v.slider('#vp-wall', 1.2, { ms: 1000 });
        await v.sleep(700);
      },
    },
    {
      kapitel: 'Erstellen',
      say: 'Vase erstellen.',
      at: '#vase-footer .btn.pri',
      hold: 0.2,
      run: async (v) => {
        await v.click('#vase-footer .btn.pri', { after: 400 });
        await v.until(() => !document.querySelector('#vase-modal.show'), {
          timeout: 180000,
          msg: 'Vase erzeugen',
        });
        await v.unspot();
        await v.sleep(1200);
      },
    },
    {
      kapitel: 'Ergebnis',
      say:
        'Fertig — mit Boden, hohl und in einem Stück. Gedruckt wird sie ' +
        'stehend und ohne Stützen.',
      at: null,
      hold: 0.4,
      run: async (v) => {
        await v.fit();
        await v.orbit({ dx: 160, dy: -35, ms: 1800, from: { x: 900, y: 600 } });
        await v.orbit({ dx: -120, dy: 20, ms: 1200, from: { x: 1050, y: 580 } });
      },
    },
    {
      kapitel: 'Export',
      say:
        'Dann exportieren und ab in den Slicer. Das war der Vasen-Generator.',
      at: '.btn.pri.main-stl',
      hold: 0.8,
      run: async (v) => {
        await v.moveTo('.btn.pri.main-stl', 800);
      },
    },
  ],
};
