/* Howto: Werkzeug-Einleger — aus einem Foto wird ein Gridfinity-Einsatz.
 *
 * Der Knackpunkt für neue Nutzer ist nicht die Bedienung, sondern die
 * Vorbereitung: Werkzeug auf ein weißes A4-Blatt, senkrecht von oben
 * fotografieren. Das Blatt ist der Maßstab — deshalb müssen seine vier Ecken
 * angeklickt werden. Das nimmt im Video den meisten Raum ein.
 */
import fs from 'node:fs';

const DIR = new URL('../assets/', import.meta.url).pathname;
const FOTO = DIR + 'werkzeug-a4.png';
const META = JSON.parse(fs.readFileSync(DIR + 'werkzeug-a4.json', 'utf8'));

/**
 * Bildpixel → Bildschirmposition auf der Zeichenfläche.
 * Rechnet den „contain"-Fit nach, mit dem die App das Foto einpasst
 * (volme3d.html, _wzDraw): gleiche Skalierung, gleiche Zentrierung.
 */
async function eckePunkt(v, [ix, iy]) {
  return v.eval(
    ([ix, iy, GW, GH]) => {
      const cv = document.getElementById('wz-canvas');
      const r = cv.getBoundingClientRect();
      const s = Math.min(cv.width / GW, cv.height / GH);
      const ox = (cv.width - GW * s) / 2;
      const oy = (cv.height - GH * s) / 2;
      return {
        x: r.left + (ox + ix * s) * (r.width / cv.width),
        y: r.top + (oy + iy * s) * (r.height / cv.height),
      };
    },
    [ix, iy, META.groesse[0], META.groesse[1]]
  );
}

export default {
  id: 'werkzeug-einleger',
  modal: 'wz-modal',
  title: 'Werkzeug-Einleger',
  subtitle: 'Vom Foto zum passgenauen Gridfinity-Einsatz',
  icon: '🧰',

  introText:
    'Moin! Wir bauen einen Werkzeug-Einleger, in den jedes Teil auf den ' +
    'Millimeter passt — und zwar aus nichts weiter als einem Handyfoto.',

  outroTitle: 'Fertig zum Drucken!',
  outroText:
    'Das war der Werkzeug-Einleger. Ein weißes Blatt, ein Foto von oben — ' +
    'mehr braucht es für eine aufgeräumte Schublade nicht.',

  tags: ['gridfinity', 'werkstatt', 'organizer'],

  scenes: [
    {
      kapitel: 'Das richtige Foto',
      say:
        'Vorweg das Wichtigste: Leg dein Werkzeug mit etwas Abstand auf ein ' +
        'weißes DIN-A4-Blatt und fotografiere möglichst senkrecht von oben. ' +
        'Das Blatt ist der Maßstab — daran rechnet der Generator alle ' +
        'Millimeter aus.',
      at: '.st-card:has-text("Werkzeug-Einleger")',
      hold: 0.5,
      run: async (v) => {
        await v.scroll('.st-card:has-text("Werkzeug-Einleger")');
      },
    },
    {
      kapitel: 'Generator öffnen',
      say: 'Den Generator findest du in der Vorlagen-Galerie.',
      at: '.st-card:has-text("Werkzeug-Einleger")',
      hold: 0.3,
      run: async (v) => {
        await v.click('.st-card:has-text("Werkzeug-Einleger")', { after: 900 });
      },
    },
    {
      kapitel: 'Foto laden',
      say: 'Foto laden — hier mein Ringschlüssel und ein Schraubendreher.',
      at: '#wz-modal button:has-text("Foto wählen")',
      run: async (v) => {
        await v.upload('#wz-modal button:has-text("Foto wählen")', FOTO, {
          after: 1600,
        });
      },
    },
    {
      kapitel: 'Die vier Blattecken',
      say:
        'Jetzt klickst du die vier Ecken des Blattes an. Damit weiß das ' +
        'Programm, wie groß alles in Wirklichkeit ist, und rechnet gleichzeitig ' +
        'die schräge Aufnahme gerade. Die Reihenfolge ist egal.',
      at: '#wz-canvas',
      pad: 6,
      run: async (v) => {
        for (const ecke of META.ecken) {
          await v.clickAt(await eckePunkt(v, ecke), { moveMs: 620, after: 420 });
        }
        await v.sleep(1200);
      },
    },
    {
      kapitel: 'Was erkannt wurde',
      say:
        'Fertig entzerrt — und unten steht, was gefunden wurde: zwei Teile und ' +
        'die passende Gridfinity-Größe. Das rechnet der Generator selbst aus.',
      at: '#wz-info',
      pad: 10,
      hold: 0.8,
    },
    {
      kapitel: 'Erkennung nachjustieren',
      say:
        'Sitzt eine Kontur nicht sauber, hilft die Schwelle: Sie trennt ' +
        'Werkzeug von Papier. Bei dunklem Werkzeug auf hellem Blatt passt der ' +
        'Standard meistens.',
      at: '#wz-thr',
      run: async (v) => {
        await v.slider('#wz-thr', 100, { ms: 800 });
        await v.sleep(900);
        await v.slider('#wz-thr', 128, { ms: 800 });
        await v.sleep(500);
      },
    },
    {
      kapitel: 'Spiel — wie satt es sitzt',
      say:
        'Das Spiel entscheidet, wie satt das Werkzeug in der Tasche sitzt. ' +
        'Ein halber Millimeter ist saugend, ein ganzer lässt es leicht ' +
        'herausnehmen.',
      at: '#wz-clr',
      run: async (v) => {
        await v.slider('#wz-clr', 0.8, { ms: 900 });
        await v.sleep(700);
      },
    },
    {
      kapitel: 'Tiefe der Tasche',
      say:
        'Als Taschentiefe nimmst du grob die halbe Werkzeugdicke — dann liegt ' +
        'das Teil sicher und lässt sich trotzdem greifen.',
      at: '#wz-depth',
      run: async (v) => {
        await v.slider('#wz-depth', 14, { ms: 900 });
        await v.sleep(500);
      },
    },
    {
      kapitel: 'Fingermulde',
      say:
        'Die Fingermulde ist eine kleine Kuhle neben jeder Tasche. Ohne sie ' +
        'bekommst du flache Teile kaum wieder heraus.',
      at: '#wzg-fin',
      pad: 6,
      hold: 0.6,
    },
    {
      kapitel: 'Höhe und Gridfinity-Füße',
      say:
        'Die Höhe zählt in Gridfinity-Einheiten zu je sieben Millimetern. ' +
        'Mit den Füßen rastet der Einsatz in jedes Gridfinity-Raster — ohne ' +
        'sie bekommst du eine flache Platte für die Schublade.',
      at: '#wz-hu',
      run: async (v) => {
        await v.slider('#wz-hu', 4, { ms: 800 });
        await v.sleep(600);
        await v.spot('#wzg-feet', 6);
        await v.sleep(1400);
      },
    },
    {
      kapitel: 'Erzeugen',
      say: 'Erzeugen — und der Einsatz ist fertig.',
      at: '#wz-go',
      hold: 0.2,
      run: async (v) => {
        await v.click('#wz-go', { after: 400 });
        await v.until(() => !document.querySelector('#wz-modal.show'), {
          timeout: 180000,
          msg: 'Einleger erzeugen',
        });
        await v.unspot();
        await v.sleep(1200);
      },
    },
    {
      kapitel: 'Ergebnis',
      say:
        'Jede Tasche hat die Form ihres Werkzeugs, die Mulden sind da, ' +
        'die Füße auch. Gedruckt wird flach auf dem Rücken, ganz ohne Stützen.',
      at: null,
      hold: 0.4,
      run: async (v) => {
        await v.fit();
        await v.orbit({ dx: 150, dy: -45, ms: 1700, from: { x: 900, y: 600 } });
        await v.orbit({ dx: -120, dy: 30, ms: 1200, from: { x: 1050, y: 580 } });
      },
    },
    {
      kapitel: 'Export',
      say:
        'Bleibt der Export — und die Schublade sieht endlich aus wie im ' +
        'Werkzeugkoffer. Das war der Werkzeug-Einleger.',
      at: '.btn.pri.main-stl',
      hold: 0.8,
      run: async (v) => {
        await v.moveTo('.btn.pri.main-stl', 800);
      },
    },
  ],
};
