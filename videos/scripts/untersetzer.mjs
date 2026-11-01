/* Kursvideo: Untersetzer (Grundkurs Tag 2, Aufgabe 1).
 * Zylinder Ø90 × 5 → Gehäuse (aushöhlen): Deckfläche anklicken, Wandstärke 2 → Anwenden.
 * Lehrziel: Aushöhlen = aus jedem Grundkörper eine Schale machen.
 */
import { schild, taste, schwenk, blick, bereit, neueForm, tippFeld, oberseite } from '../lib/kurs.mjs';

export default {
  id: 'untersetzer',
  modal: null,
  title: 'Untersetzer',
  subtitle: '3D-Druck Grundkurs · Tag 2 · Aufgabe 1',
  icon: '🥃',

  introText: 'Moin! Aufgabe eins: ein Untersetzer. Wir machen aus einer runden Scheibe eine flache Schale – mit dem Gehäuse-Werkzeug.',
  outroTitle: 'Untersetzer fertig!',
  outroText: 'Grundkörper, Deckfläche anklicken, aushöhlen – so wird aus jedem Körper eine Schale. Viel Spaß beim Drucken!',
  tags: ['grundkurs', 'untersetzer', 'aushoehlen', 'gehaeuse', 'zylinder', 'anfaenger'],

  async ready(v) { await bereit(v); },

  scenes: [
    {
      kapitel: '1 · Zylinder',
      say: 'Rechts: Körper hinzufügen, Zylinder. Links tippst du Durchmesser neunzig und Höhe fünf, jeweils Enter.',
      run: async (v) => {
        await schild(v, 1, 'Körper hinzufügen → <b>Zylinder</b> · Ø <b>90</b>, Höhe <b>5</b>');
        await neueForm(v, 'cylinder');
        await tippFeld(v, '#fp-r', 90);
        await tippFeld(v, '#fph', 5);
        await blick(v);
      },
    },
    {
      kapitel: '2 · Aushöhlen',
      say: 'Jetzt Gehäuse aushöhlen anklicken. Dann oben auf die Deckfläche klicken – sie wird orange und bleibt offen.',
      run: async (v) => {
        await schild(v, 2, '<b>Gehäuse (aushöhlen)</b> → Deckfläche anklicken (wird orange)');
        await v.click('button[onclick="enterShellMode()"]:visible', { after: 700 });
        await schwenk(v, 0.75, 0.6, 1200);
        await v.clickAt(await oberseite(v, 0), { moveMs: 700, after: 900 });
      },
    },
    {
      kapitel: '3 · Wandstärke',
      say: 'Wandstärke zwei, dann Anwenden. Fertig ist der Untersetzer mit zwei Millimeter hohem Rand.',
      run: async (v) => {
        await schild(v, 3, 'Wandstärke <b>2</b> → <b>Anwenden</b>');
        await v.eval(() => { const e = document.getElementById('fp-shell-wall'); e.value = 2; e.dispatchEvent(new Event('input', { bubbles: true })); });
        await v.sleep(600);
        await v.click('button[onclick="applyShell()"]:visible', { after: 400 });
        await v.until(() => !objects.some((o) => o.userData.isHole) && objects.length === 1, { timeout: 60000, msg: 'ausgehöhlt' });
        await v.eval(() => selectObjs([]));
        await blick(v);
        await schwenk(v, 1.1, 0.5, 1800);
      },
    },
  ],
};
