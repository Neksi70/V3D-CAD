/* Kursvideo: Eigene Form mit der Skizze (Grundkurs Tag 2, Aufgabe 4).
 * Skizze → Linie, Ortho-Fang aus (O), Punkt für Punkt ein Haus klicken, auf
 * den Startpunkt schließen → Höhe 5 → Extrudieren → OK.
 * Lehrziel: aus einer selbst gezeichneten, geschlossenen Form einen Körper machen.
 */
import { schild, taste, schwenk, blick, bereit, skizzePunkt } from '../lib/kurs.mjs';

// Haus-Umriss (u, v in mm): Startpunkt unten links, gegen den Uhrzeigersinn, Dach als Spitze.
const HAUS = [[-20, -16], [20, -16], [20, 8], [0, 26], [-20, 8]];

export default {
  id: 'skizze-form',
  modal: null,
  title: 'Eigene Form mit der Skizze',
  subtitle: '3D-Druck Grundkurs · Tag 2 · Aufgabe 4',
  icon: '✏️',

  introText: 'Moin! Aufgabe vier: eine eigene Form zeichnen. Wir skizzieren ein Haus Punkt für Punkt und ziehen es dann in die Höhe.',
  outroTitle: 'Form fertig!',
  outroText: 'Zeichnen, schließen, extrudieren – so wird aus deiner Skizze ein Körper. Genauso gehen Stern, Pfeil oder ein Buchstabe. Viel Spaß beim Drucken!',
  tags: ['grundkurs', 'skizze', 'extrudieren', 'eigene form', 'haus', 'anfaenger'],

  async ready(v) {
    await bereit(v);
    await v.eval(() => { enterSketchMode(); });
    await v.sleep(500);
    // Fast von oben, leicht gekippt – Klicks landen sauber auf der Zeichenebene
    await v.eval(() => { sph.phi = 0.22; sph.theta = 0.0; sph.r = 14; sph2cam(); });
  },

  scenes: [
    {
      kapitel: '1 · Ortho aus',
      say: 'Wir sind in der Skizze, Werkzeug Linie. Erst den Ortho-Fang ausschalten – Taste O. Sonst würden nur waagerechte und senkrechte Linien gehen, aber das Dach ist schräg.',
      run: async (v) => {
        await schild(v, 1, 'Werkzeug <b>Linie</b> · <b>Ortho-Fang aus</b> (Taste O) – für schräge Linien');
        await v.sleep(1000);
        await taste(v, 'O');
        await v.eval(() => { if (_sk.ortho) _skToggleOrtho(); });
        await v.sleep(700);
        await taste(v, '');
      },
    },
    {
      kapitel: '2 · Haus zeichnen',
      say: 'Jetzt Punkt für Punkt klicken: die vier Ecken für die Wände, oben die Spitze für das Dach. Zum Schluss wieder auf den allerersten Punkt – dann ist die Form geschlossen.',
      run: async (v) => {
        await schild(v, 2, 'Punkt für Punkt klicken · zum Schluss auf den <b>Startpunkt</b> = geschlossen');
        await v.eval(() => _skSetTool('line'));
        for (const [u, w] of HAUS) {
          await v.clickAt(await skizzePunkt(v, u, w), { moveMs: 600, after: 450 });
        }
        // auf den Startpunkt zurück → schließt die Form
        await v.clickAt(await skizzePunkt(v, HAUS[0][0], HAUS[0][1]), { moveMs: 650, after: 600 });
        await v.until(() => _skBuildShapes().length >= 1, { timeout: 8000, msg: 'Form geschlossen' }).catch(() => {});
        await v.sleep(600);
      },
    },
    {
      kapitel: '3 · Höhe 5',
      say: 'Unten links die Höhe fünf eintragen. Das ist, wie dick das Haus wird.',
      run: async (v) => {
        await schild(v, 3, 'Unten links <b>Höhe 5</b> eintragen');
        await v.type('#sketch-h', '5', { delay: 150 });
        await v.sleep(600);
      },
    },
    {
      kapitel: '4 · Extrudieren',
      say: 'Dann auf Extrudieren, und im Fenster auf OK. Fertig ist das Haus, fünf Millimeter dick.',
      run: async (v) => {
        await schild(v, 4, '<b>✓ Extrudieren…</b> → im Fenster <b>✓ OK</b>');
        await v.click('button[onclick="_skExtrude()"]', { after: 900 });
        await v.click('#skx-ok', { after: 600 });
        await v.until(() => !_sk.active && objects.length === 1 && !objects[0].userData.isHole, { timeout: 60000, msg: 'extrudiert' });
        await v.eval(() => { selectObjs([]); fitView(); sph.phi = 0.9; sph.theta = 0.6; sph.r *= 1.35; sph2cam(); });
        await schwenk(v, 1.1, 1.0, 1800);
      },
    },
  ],
};
