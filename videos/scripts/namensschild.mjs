/* Howto: Namensschild / Schlüsselanhänger
 *
 * Aufbau wie bei allen Generator-Videos:
 *   Ergebnis versprechen → Generator öffnen → die 3–4 Regler erklären,
 *   die wirklich etwas ändern → erstellen → Ergebnis von allen Seiten → Druck.
 */
export default {
  id: 'namensschild',
  modal: 'name-modal', // hier hängt die App ihren Hilfe-Knopf ein
  title: 'Namensschild & Schlüsselanhänger',
  subtitle: 'In 90 Sekunden zum fertigen Anhänger',
  icon: '🏷️',

  introText:
    'Moin! In diesem Video bauen wir einen Schlüsselanhänger mit Namen — ' +
    'ganz ohne Zeichnen, nur mit ein paar Schiebereglern.',

  outroTitle: 'Fertig zum Drucken!',
  outroText:
    'Das war der Namensschild-Generator. Viel Spaß beim Drucken — ' +
    'und schau dir gern die anderen Generatoren an.',

  scenes: [
    {
      kapitel: 'Vorlagen-Galerie',
      say:
        'V3D CAD begrüßt dich mit der Vorlagen-Galerie. Hier liegen fertige ' +
        'Generatoren für die häufigsten Druckideen.',
      at: '#start-grid',
      pad: 6,
      hold: 0.5,
    },
    {
      kapitel: 'Generator öffnen',
      say: 'Für unseren Anhänger nehmen wir das Namensschild.',
      at: '.st-card:has-text("Namensschild")',
      hold: 0.3,
      run: async (v) => {
        await v.click('.st-card:has-text("Namensschild")', { after: 900 });
      },
    },
    {
      kapitel: 'Die Oberfläche',
      say:
        'Links siehst du eine echte 3D-Vorschau, rechts die Einstellungen. ' +
        'Jede Änderung erscheint sofort in der Vorschau.',
      at: '#name-canvas',
      pad: 10,
      hold: 0.6,
    },
    {
      kapitel: 'Namen eintippen',
      say: 'Zuerst der Name — ich schreibe Mia.',
      at: '#name-text',
      run: async (v) => {
        await v.type('#name-text', 'Mia');
        await v.sleep(700);
      },
    },
    {
      kapitel: 'Bauart wählen',
      say:
        'Bei der Bauart hast du die Wahl: Text auf Platte ergibt ein klassisches ' +
        'Schild. Freistehend verbindet die Buchstaben zu einem Stück ' +
        'Schreibschrift — so wie gekaufte Anhänger. Dabei bleiben wir.',
      at: '#name-style',
      hold: 0.4,
      run: async (v) => {
        await v.select('#name-style', 'plate');
        await v.sleep(1600);
        await v.select('#name-style', 'free');
        await v.sleep(900);
      },
    },
    {
      kapitel: 'Schrift wählen',
      say:
        'Die Schrift bestimmt den Charakter. Lobster ist eine fette ' +
        'Schreibschrift — die verbindet sich besonders gut.',
      at: '#name-font',
      run: async (v) => {
        await v.select('#name-font', 'lobster_local');
        await v.sleep(1400);
      },
    },
    {
      kapitel: 'Größe in Millimetern',
      say:
        'Die Texthöhe ist das echte Maß in Millimetern. Für einen ' +
        'Schlüsselanhänger sind etwa zwanzig Millimeter passend.',
      at: '#name-size',
      run: async (v) => {
        await v.slider('#name-size', 20, { ms: 1100 });
        await v.sleep(600);
      },
    },
    {
      kapitel: 'Überlappung — der wichtigste Regler',
      say:
        'Jetzt der wichtigste Regler: die Überlappung. Je weiter die Buchstaben ' +
        'ineinandergreifen, desto sicherer hält der Anhänger als ein Stück ' +
        'zusammen. Zu wenig, und einzelne Buchstaben brechen ab.',
      at: '#name-row-overlap',
      run: async (v) => {
        await v.slider('#name-overlap', 12, { ms: 900 });
        await v.sleep(900);
        await v.slider('#name-overlap', 34, { ms: 900 });
        await v.sleep(500);
      },
    },
    {
      kapitel: 'Relief',
      say:
        'Das Relief macht jeden zweiten Buchstaben dicker. Das sieht nicht nur ' +
        'gut aus, es verzahnt die Buchstaben zusätzlich.',
      at: '#name-row-stagger',
      run: async (v) => {
        await v.slider('#name-stagger', 60, { ms: 900 });
        await v.sleep(700);
      },
    },
    {
      kapitel: 'Öse für den Schlüsselring',
      say:
        'Die Öse für den Schlüsselring ist schon dabei — Lochgröße und Position ' +
        'kannst du frei wählen.',
      at: '#name-eyelet-d-row',
      run: async (v) => {
        await v.slider('#name-eyelet-d', 5, { ms: 700 });
        await v.sleep(500);
      },
    },
    {
      kapitel: 'Erstellen',
      say: 'Ein Klick auf Erstellen — und der Anhänger landet als echter Körper in der Szene.',
      at: '#name-modal .btn.pri',
      hold: 0.2,
      run: async (v) => {
        await v.click('#name-modal .btn.pri', { after: 400 });
        await v.until(() => !document.querySelector('#name-modal.show'), {
          timeout: 90000,
          msg: 'Namensschild erzeugen',
        });
        await v.unspot();
        await v.sleep(1200);
      },
    },
    {
      kapitel: 'Ergebnis ansehen',
      say:
        'Du kannst ihn drehen, messen und wie jeden anderen Körper ' +
        'weiterbearbeiten — zum Beispiel einfärben oder mit anderen Formen kombinieren.',
      at: null,
      hold: 0.4,
      run: async (v) => {
        await v.fit();
        await v.orbit({ dx: 170, dy: -50, ms: 1700, from: { x: 900, y: 620 } });
        await v.orbit({ dx: -130, dy: 30, ms: 1300, from: { x: 1100, y: 600 } });
      },
    },
    {
      kapitel: 'Druck-Check',
      say:
        'Neben dem Export-Knopf klappt ein Menü auf. Dort sitzt der Druck-Check: ' +
        'Er prüft, ob das Teil wasserdicht ist, aufs Bett passt und sauber auf ' +
        'der Platte liegt — besser jetzt als nach drei Stunden Druckzeit.',
      at: '.btn.pri.spl',
      run: async (v) => {
        await v.click('.btn.pri.spl', { after: 700 });
        await v.spot('#stl-menu [onclick*="_printCheckOpen"]');
        await v.sleep(900);
        await v.click('#stl-menu [onclick*="_printCheckOpen"]', { after: 2800 });
      },
    },
    {
      kapitel: 'Export',
      say:
        'Passt alles, exportierst du die STL-Datei und schickst sie in den Slicer. ' +
        'Das war der ganze Weg.',
      at: '.btn.pri.main-stl',
      hold: 0.8,
      run: async (v) => {
        // Prüf-Fenster schließen, damit der Export-Knopf frei liegt
        await v.eval(() => {
          document
            .querySelectorAll('.g3dm.show, .modal.show')
            .forEach((m) => m.classList.remove('show'));
        });
        await v.sleep(600);
        await v.moveTo('.btn.pri.main-stl', 800);
      },
    },
  ],
};
