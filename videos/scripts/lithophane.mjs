/* Howto: Lithophane — aus einem Foto wird ein Relief, das im Gegenlicht leuchtet.
 *
 * Das Prinzip muss zuerst sitzen, sonst wirken alle Regler willkürlich:
 * dunkle Stellen werden dick und lassen wenig Licht durch, helle werden dünn.
 * Deshalb erklärt das Video Max- und Basis-Dicke als Paar und schließt mit dem
 * Hinweis, dass ein Lithophane stehend gedruckt und gegen Licht gehalten wird.
 */
const FOTO = new URL('../assets/berge.jpg', import.meta.url).pathname;

export default {
  id: 'lithophane',
  modal: 'litho-modal',
  title: 'Lithophane',
  subtitle: 'Ein Foto, das im Gegenlicht erscheint',
  icon: '🖼️',

  introText:
    'Moin! Wir machen aus einem Foto ein Lithophane — eine dünne Platte, ' +
    'die erst im Gegenlicht ihr Bild zeigt.',

  outroTitle: 'Fertig zum Drucken!',
  outroText:
    'Das war der Lithophane-Generator. Stehend drucken, ans Fenster halten — ' +
    'und das Bild ist da.',

  tags: ['lithophane', 'foto', 'geschenk'],

  scenes: [
    {
      kapitel: 'Generator öffnen',
      say:
        'Den Lithophane-Generator findest du in der Vorlagen-Galerie.',
      at: '.st-card:has-text("Lithophane")',
      hold: 0.4,
      run: async (v) => {
        await v.scroll('.st-card:has-text("Lithophane")');
        await v.click('.st-card:has-text("Lithophane")', { after: 900 });
      },
    },
    {
      kapitel: 'Bild laden',
      say:
        'Bild aussuchen. Am besten funktionieren Motive mit kräftigem ' +
        'Kontrast — hier eine Bergkette im Gegenlicht.',
      at: '#litho-drop',
      run: async (v) => {
        await v.upload('#litho-drop', FOTO, { after: 1500 });
        await v.until(() => {
          const b = document.getElementById('litho-create-btn');
          return b && !b.disabled;
        }, { timeout: 60000, msg: 'Bild einlesen' });
      },
    },
    {
      kapitel: 'Wie ein Lithophane funktioniert',
      say:
        'Und so entsteht das Bild: Wo das Foto dunkel ist, wird die Platte ' +
        'dick und lässt wenig Licht durch. Wo es hell ist, wird sie dünn und ' +
        'leuchtet. Das ganze Foto steckt also in der Materialstärke.',
      at: '#litho-canvas',
      pad: 10,
      hold: 0.9,
    },
    {
      kapitel: 'Breite',
      say:
        'Die Breite ist das fertige Maß in Millimetern. Hundertzwanzig passen ' +
        'gut auf eine Fensterbank oder in einen Rahmen.',
      at: '#lp-width',
      run: async (v) => {
        await v.slider('#lp-width', 120, { ms: 1000 });
        await v.sleep(500);
      },
    },
    {
      kapitel: 'Max-Dicke und Basis-Dicke',
      say:
        'Diese beiden Regler gehören zusammen: Die Max-Dicke gilt für die ' +
        'dunkelsten Stellen, die Basis-Dicke für die hellsten. Je weiter die ' +
        'zwei auseinanderliegen, desto kräftiger der Kontrast. Unter einem ' +
        'halben Millimeter wird es allerdings fragil.',
      at: '#lp-maxt',
      run: async (v) => {
        await v.slider('#lp-maxt', 3.6, { ms: 900 });
        await v.sleep(600);
        await v.spot('#lp-mint');
        await v.slider('#lp-mint', 0.6, { ms: 900 });
        await v.sleep(600);
      },
    },
    {
      kapitel: 'Auflösung',
      say:
        'Die Auflösung entscheidet, wie fein die Abstufungen werden. Mehr ist ' +
        'schöner, macht die Datei aber schwerer — und feiner als deine Düse ' +
        'drucken kann, bringt ohnehin nichts.',
      at: '#lp-res',
      run: async (v) => {
        await v.slider('#lp-res', 320, { ms: 900 });
        await v.sleep(600);
      },
    },
    {
      kapitel: 'Rahmen',
      say:
        'Ein schmaler Rahmen gibt der dünnen Platte Halt und sieht nebenbei ' +
        'aufgeräumter aus.',
      at: '#lp-frame',
      run: async (v) => {
        await v.slider('#lp-frame', 3, { ms: 800 });
        await v.sleep(700);
      },
    },
    {
      kapitel: 'Negativ',
      say:
        'Negativ dreht das Verhältnis um — das brauchst du nur, wenn du ein ' +
        'bereits invertiertes Bild verwendest.',
      at: '#lp-invert',
      pad: 10,
      hold: 0.6,
    },
    {
      kapitel: 'Erstellen',
      say: 'Erstellen — das Relief wird jetzt aus dem Bild gerechnet.',
      at: '#litho-create-btn',
      hold: 0.2,
      run: async (v) => {
        await v.click('#litho-create-btn', { after: 400 });
        await v.until(() => !document.querySelector('#litho-modal.show'), {
          timeout: 240000,
          msg: 'Lithophane erzeugen',
        });
        await v.unspot();
        await v.sleep(1400);
      },
    },
    {
      kapitel: 'Ergebnis',
      say:
        'In der Draufsicht ahnst du die Bergrücken schon als feine Stufen. ' +
        'Viel mehr ist im 3D-Programm auch nicht zu sehen — und das ist genau ' +
        'richtig so: Das Bild steckt in Bruchteilen von Millimetern und ' +
        'erscheint erst, wenn Licht dahinter steht.',
      at: null,
      hold: 0.4,
      run: async (v) => {
        await v.view('top');
        await v.zoom(-260);
      },
    },
    {
      kapitel: 'Richtig drucken',
      say:
        'Wichtig fürs Drucken: stehend aufstellen, damit die Schichten quer ' +
        'zum Licht liegen. Keine Stützen, lieber langsam und mit dünner ' +
        'Schicht — und weiß oder ein helles Filament nehmen.',
      at: null,
      hold: 0.6,
      run: async (v) => {
        await v.view('iso');
        await v.orbit({ dx: 110, dy: 45, ms: 1400, from: { x: 900, y: 580 } });
      },
    },
    {
      kapitel: 'Export',
      say: 'Dann exportieren — das war das Lithophane.',
      at: '.btn.pri.main-stl',
      hold: 0.8,
      run: async (v) => {
        await v.moveTo('.btn.pri.main-stl', 800);
      },
    },
  ],
};
