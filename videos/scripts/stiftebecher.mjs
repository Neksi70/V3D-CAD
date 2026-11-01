/* Kursvideo: Stiftebecher (Grundkurs Tag 2, Aufgabe 3).
 * Zylinder Ø70 × 90, als Sechseck mit weichem Rand, dann aushöhlen – wie der
 * Untersetzer, nur hoch. Zeigt „Seiten“ und „obere Kante abrunden“.
 */
import { schild, taste, schwenk, blick, bereit, neueForm, tippFeld, oberseite } from '../lib/kurs.mjs';

const regler = (v, id, wert) =>
  v.eval(([id, wert]) => { const e = document.getElementById(id); e.value = wert; e.dispatchEvent(new Event('input', { bubbles: true })); }, [id, wert]);

export default {
  id: 'stiftebecher',
  modal: null,
  title: 'Stiftebecher',
  subtitle: '3D-Druck Grundkurs · Tag 2 · Aufgabe 3',
  icon: '🖊️',

  introText: 'Moin! Aufgabe drei: ein Stiftebecher. Das ist derselbe Trick wie beim Untersetzer – nur hoch.',
  outroTitle: 'Becher fertig!',
  outroText: 'Zylinder hoch, aushöhlen – fertig ist der Becher. Mehr Pfiff? Stell vor dem Aushöhlen die Seiten auf sechs für einen Sechskant, oder runde die obere Kante ab. Viel Spaß beim Drucken!',
  tags: ['grundkurs', 'becher', 'stiftebecher', 'aushoehlen', 'zylinder', 'anfaenger'],

  async ready(v) { await bereit(v); },

  scenes: [
    {
      kapitel: '1 · Zylinder',
      say: 'Körper hinzufügen, Zylinder. Durchmesser siebzig, Höhe neunzig.',
      run: async (v) => {
        await schild(v, 1, 'Körper hinzufügen → <b>Zylinder</b> · Ø <b>70</b>, Höhe <b>90</b>');
        await neueForm(v, 'cylinder');
        await tippFeld(v, '#fp-r', 70);
        await tippFeld(v, '#fph', 90);
        await blick(v);
      },
    },
    {
      kapitel: '2 · Aushöhlen',
      say: 'Wie beim Untersetzer: Gehäuse aushöhlen, oben auf die Deckfläche klicken, Wandstärke zwei, Anwenden.',
      run: async (v) => {
        await schild(v, 2, '<b>Gehäuse (aushöhlen)</b> → Deckfläche → Wandstärke <b>2</b> → <b>Anwenden</b>');
        await v.click('button[onclick="enterShellMode()"]:visible', { after: 700 });
        await schwenk(v, 0.6, 0.6, 1200);
        await v.clickAt(await oberseite(v, 0), { moveMs: 700, after: 900 });
        await regler(v, 'fp-shell-wall', 2);
        await v.sleep(600);
        await v.click('button[onclick="applyShell()"]:visible', { after: 400 });
        await v.until(() => !objects.some((o) => o.userData.isHole) && objects.length === 1, { timeout: 60000, msg: 'ausgehöhlt' });
        await v.eval(() => selectObjs([]));
        await blick(v);
        await schwenk(v, 0.85, 0.9, 1800);
      },
    },
  ],
};
