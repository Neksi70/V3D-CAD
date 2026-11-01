/* Kursvideo: Schlüsselanhänger (Grundkurs Tag 2, Aufgabe 2).
 * Box 50×25×3 mit runden Ecken (Radius 5), Loch Ø5 per Bohrung + Abziehen.
 * Lehrziel: Position (cm, Mitte) statt Teile verschieben; ○ Bohrung + ⊖ Abziehen.
 */
import { schild, taste, schwenk, blick, bereit, neueForm, tippFeld } from '../lib/kurs.mjs';

const regler = (v, id, wert) =>
  v.eval(([id, wert]) => { const e = document.getElementById(id); e.value = wert; e.dispatchEvent(new Event('input', { bubbles: true })); }, [id, wert]);

/** Positionsfeld (cm, Körpermitte): X = #px, Y = #pz. */
async function position(v, id, wert) {
  await v.eval(([id, wert]) => { const e = document.getElementById(id); e.value = wert; e.dispatchEvent(new Event('change', { bubbles: true })); }, [id, wert]);
  await v.sleep(400);
}

export default {
  id: 'schluesselanhaenger',
  modal: null,
  title: 'Schlüsselanhänger',
  subtitle: '3D-Druck Grundkurs · Tag 2 · Aufgabe 2',
  icon: '🔑',

  introText: 'Moin! Aufgabe zwei: ein Schlüsselanhänger mit Loch. Du lernst: Teile über die Position genau hinsetzen und ein Loch abziehen.',
  outroTitle: 'Anhänger fertig!',
  outroText: 'Grundform, Bohrung an die richtige Stelle, abziehen – fertig. Das Loch sitzt sechs Millimeter vom Rand. Viel Spaß beim Drucken!',
  tags: ['grundkurs', 'schluesselanhaenger', 'bohrung', 'abziehen', 'position', 'anfaenger'],

  async ready(v) { await bereit(v); },

  scenes: [
    {
      kapitel: '1 · Grundform',
      say: 'Körper hinzufügen, Box. Länge fünfzig, Tiefe fünfundzwanzig, Höhe drei. Und Radius fünf – das macht runde Ecken.',
      run: async (v) => {
        await schild(v, 1, 'Box <b>50 × 25 × 3</b> mm · <b>Radius 5</b> = runde Ecken');
        await neueForm(v, 'box');
        await tippFeld(v, '#fpw', 50);
        await tippFeld(v, '#fpd', 25);
        await tippFeld(v, '#fph', 3);
        await regler(v, 'fp-fil', 5);
        await v.sleep(700);
        await blick(v);
      },
    },
    {
      kapitel: '2 · Bohrung',
      say: 'Jetzt oben rechts auf Bohrung umschalten. Dann ein Zylinder: Durchmesser fünf, Höhe zehn – er ist rot. Danach wieder zurück auf Solid.',
      run: async (v) => {
        await schild(v, 2, '<b>○ Bohrung</b> → Zylinder Ø <b>5</b>, Höhe <b>10</b> (rot) → zurück <b>● Solid</b>');
        await v.click('#mb-h', { after: 500 });
        await neueForm(v, 'cylinder');
        await tippFeld(v, '#fp-r', 5);
        await tippFeld(v, '#fph', 10);
        await v.click('#mb-s', { after: 400 });
        await blick(v);
      },
    },
    {
      kapitel: '3 · Position',
      say: 'Damit das Loch an die richtige Stelle kommt: Reiter Eigenschaften, Position. Das Loch auf X minus eins Komma neun, Y null. Die Box auf X null, Y null. Position ist in Zentimetern und meint die Mitte.',
      run: async (v) => {
        await schild(v, 3, 'Eigenschaften → Position (cm, Mitte): Loch <b>X −1,9 · Y 0</b> · Box <b>X 0 · Y 0</b>');
        // Loch (zuletzt angelegt = objects[1]) positionieren
        await v.eval(() => selectObjs([objects[1]]));
        await v.sleep(500);
        await position(v, 'px', -1.9);
        await position(v, 'pz', 0);
        // Box auf Mitte
        await v.eval(() => selectObjs([objects[0]]));
        await v.sleep(500);
        await position(v, 'px', 0);
        await position(v, 'pz', 0);
        await blick(v);
      },
    },
    {
      kapitel: '4 · Abziehen',
      say: 'Jetzt einen Rahmen um beide ziehen und oben Abziehen. Fertig ist der Anhänger mit Loch.',
      run: async (v) => {
        await schild(v, 4, 'Beide wählen → <b>⊖ Abziehen</b>');
        await taste(v, 'Strg A');
        await v.eval(() => selectObjs(objects.slice()));
        await v.sleep(800);
        await taste(v, '');
        await v.click('button[onclick="subtractHoles()"]', { after: 300 });
        await v.until(() => objects.length === 1 && !objects.some((o) => o.userData.isHole), { timeout: 60000, msg: 'abgezogen' });
        await v.eval(() => selectObjs([]));
        await blick(v);
        await schwenk(v, 0.6, 0.7, 1600);
      },
    },
  ],
};
