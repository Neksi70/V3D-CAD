// Symbol-Modus: alle Werkzeugknöpfe haben ein Symbol, „Anordnen“ steht ab 1280 px in Zeile 1 (v1.18.349)
import { chromium } from 'playwright';
const PORT = process.env.PORT || 8871;
const b = await chromium.launch(); let fehler = 0;
for (const w of [1280, 1920]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`); await p.waitForTimeout(2500);
  await p.evaluate(() => { for (const id of ['start-modal','auth-overlay']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; } _symToggle(true); });
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const top = g => document.querySelector(`#tb-r1 > .tbg[data-g="${g}"]`).getBoundingClientRect().top;
    const ohne = [..._symButtons()].filter(x => x.offsetParent && !x.classList.contains('symb') && x.textContent.trim().length > 2).map(x => x.textContent.trim());
    return { gleich: top('anordnen') === top('import'), ohne };
  });
  const ok = r.gleich && r.ohne.length === 0;
  console.log(ok ? '✔' : '✘', w, 'px', JSON.stringify(r)); if (!ok) fehler++;
  await p.close();
}
await b.close(); process.exit(fehler ? 1 : 0);
