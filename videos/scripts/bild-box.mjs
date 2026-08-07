/* Howto: Bild-Box — aus einem Bild wird eine Klappbox mit Motiv.
 *
 * Der erklärungsbedürftige Teil ist nicht die Bedienung, sondern was
 * eigentlich passiert: Die Silhouette des Bildes wird zur Form der Box,
 * die Farbflächen werden zum Motiv auf dem Deckel, und gedruckt wird flach
 * und offen — am Stück, ohne Stützen.
 */
const MOTIV = new URL('../assets/schmetterling.png', import.meta.url).pathname;

export default {
  id: 'bild-box',
  modal: 'ibx-modal',
  title: 'Bild-Box',
  subtitle: 'Aus einem Bild wird eine Klappbox',
  icon: '🎁',

  introText:
    'Moin! Aus einem einzigen Bild bauen wir jetzt eine Geschenkbox — ' +
    'die Form kommt von der Silhouette, das Motiv vom Bild selbst.',

  outroTitle: 'Fertig zum Drucken!',
  outroText:
    'Das war die Bild-Box. Nimm ruhig dein eigenes Motiv — ' +
    'ein PNG mit freigestelltem Hintergrund klappt am besten.',

  tags: ['geschenkbox', 'mehrfarbig'],

  scenes: [
    {
      kapitel: 'Generator öffnen',
      say:
        'In der Vorlagen-Galerie findest du weiter unten die Bild-Box.',
      at: '.st-card:has-text("Bild-Box")',
      hold: 0.4,
      run: async (v) => {
        await v.scroll('.st-card:has-text("Bild-Box")');
        await v.click('.st-card:has-text("Bild-Box")', { after: 900 });
      },
    },
    {
      kapitel: 'Bild auswählen',
      say:
        'Zuerst das Bild. Am besten ein PNG mit freigestelltem Hintergrund — ' +
        'ich nehme diesen Schmetterling.',
      at: '#ibx-drop',
      run: async (v) => {
        await v.upload('#ibx-drop', MOTIV, { after: 1400 });
        await v.until(() => {
          const b = document.getElementById('ibx-create-btn');
          return b && !b.disabled;
        }, { timeout: 60000, msg: 'Bildanalyse' });
      },
    },
    {
      kapitel: 'Was der Generator daraus macht',
      say:
        'Und das ist schon der ganze Trick: Der Umriss des Bildes wird zur Form ' +
        'der Box, die Farbflächen werden zum Motiv auf dem Deckel. Unten steht, ' +
        'was dabei herauskommt.',
      at: '#ibx-info',
      pad: 10,
      hold: 0.8,
    },
    {
      kapitel: 'Größe',
      say:
        'Die Größe meint die längste Seite in Millimetern. Achtzig ist eine ' +
        'handliche Schmuckschatulle.',
      at: '#ib-size',
      run: async (v) => {
        await v.slider('#ib-size', 80, { ms: 1000 });
        await v.sleep(500);
      },
    },
    {
      kapitel: 'Höhe',
      say:
        'Die Höhe gilt für die geschlossene Box — sie teilt sich auf zwei ' +
        'gleiche Halbschalen auf. Etwas mehr Platz schadet nicht.',
      at: '#ib-h',
      run: async (v) => {
        await v.slider('#ib-h', 38, { ms: 900 });
        await v.sleep(500);
      },
    },
    {
      kapitel: 'Farben fürs Motiv',
      say:
        'Jetzt der spannendste Regler: die Farben. Der Generator sucht die ' +
        'wichtigsten Farbflächen im Bild und legt für jede eine eigene Ebene an. ' +
        'Vier Farben treffen den Schmetterling gut — hast du nur ein Filament, ' +
        'stell einfach eins ein.',
      at: '#ib-ncol',
      run: async (v) => {
        await v.slider('#ib-ncol', 1, { ms: 800 });
        await v.sleep(1100);
        await v.slider('#ib-ncol', 4, { ms: 900 });
        await v.sleep(700);
      },
    },
    {
      kapitel: 'Scharnier-Seite',
      say:
        'An welcher Seite die Box aufklappt, entscheidest du hier. ' +
        'Beim Schmetterling wirkt das Scharnier oben am natürlichsten.',
      at: '#ibg-side',
      pad: 6,
      run: async (v) => {
        await v.click('#ibg-side .vtb:nth-child(2)', { after: 900 });
        await v.click('#ibg-side .vtb:nth-child(1)', { after: 700 });
      },
    },
    {
      kapitel: 'Verschluss',
      say:
        'Die Lippe am Rand sorgt dafür, dass der Deckel sauber schließt und ' +
        'nicht verrutscht.',
      at: '#ibg-lip',
      pad: 6,
      hold: 0.5,
    },
    {
      kapitel: 'Erstellen',
      say: 'Erstellen — und die Box liegt in der Szene.',
      at: '#ibx-create-btn',
      hold: 0.2,
      run: async (v) => {
        await v.click('#ibx-create-btn', { after: 400 });
        await v.until(() => !document.querySelector('#ibx-modal.show'), {
          timeout: 180000,
          msg: 'Bild-Box erzeugen',
        });
        await v.unspot();
        await v.sleep(1200);
      },
    },
    {
      kapitel: 'Warum sie flach daliegt',
      say:
        'Sie liegt flach und aufgeklappt da — genau so wird sie gedruckt: ' +
        'am Stück und ohne Stützen. Nach dem Druck klappst du sie einmal zu, ' +
        'das Scharnier ist schon drin.',
      at: null,
      hold: 0.4,
      run: async (v) => {
        await v.fit();
        await v.orbit({ dx: 150, dy: -55, ms: 1700, from: { x: 900, y: 600 } });
      },
    },
    {
      kapitel: 'Mehrfarbig drucken',
      say:
        'Zum Schluss das Beste: Ab zwei Farben schickt „An Slicer senden" ' +
        'automatisch eine 3MF-Datei mit fertiger Farbzuweisung — du musst im ' +
        'Slicer nichts mehr zuordnen.',
      at: '.btn.pri.spl',
      run: async (v) => {
        await v.orbit({ dx: -130, dy: 35, ms: 1200, from: { x: 1080, y: 580 } });
        await v.click('.btn.pri.spl', { after: 1400 });
      },
    },
    {
      kapitel: 'Export',
      say: 'Oder ganz klassisch als STL exportieren. Das war die Bild-Box.',
      at: '.btn.pri.main-stl',
      hold: 0.8,
      run: async (v) => {
        await v.eval(() => {
          document
            .querySelectorAll('.g3dm.show, .modal.show')
            .forEach((m) => m.classList.remove('show'));
          const m = document.getElementById('stl-menu');
          if (m) m.classList.remove('show');
        });
        await v.sleep(500);
        await v.moveTo('.btn.pri.main-stl', 800);
      },
    },
  ],
};
