// Kundenmaterial erfassen (Bestandsaufnahme Chargen ohne Wareneingang) → Lieferschein aus der AB nimmt die Charge
import { test, expect, ok, S, oeffne, beleg } from './hilfe.mjs';

test('KM-H1 Charge per Bestandsaufnahme erfassen, nachzählen, per AB liefern', async ({ pg }) => {
  const k = await ok(pg, 'adressen', { name1: 'Bestandskunde E2E', kunde: {} });
  const art = await ok(pg, 'artikel', { artikelnr: 'KM-100', bezeichnung: 'Musterbuchse honen E2E', vk_preis: 0.5, lagerfuehrung: 0 });
  await oeffne(pg, '#/kundenmaterial/' + k.id, '#kmA');
  await S(pg, '#kmA').fill('KM-100'); await S(pg, '#kmA').dispatchEvent('input');
  await S(pg, '#kmC').fill('A1/P1/B1/P2/LS9'); await S(pg, '#kmL').fill('LS9'); await S(pg, '#kmM').fill('5.000');
  await S(pg, '#kmNeu').click();
  await expect(pg.locator('#toast')).toContainText('5.000 im Haus');
  await expect(S(pg, '#kmT')).toContainText('Bestandsaufnahme');
  await S(pg, '#kmT tr .kmZ').fill('4.800'); await S(pg, '#kmZsp').click();
  await expect(pg.locator('#toast')).toContainText('nachgezählt');
  await expect(S(pg, '#kmT')).toContainText('4.800');
  const ab = await beleg(pg, { belegart: 'AB', adresse_id: k.id, positionen: [{ artikel_id: art.id, menge: 3000, einzelpreis: 0.5 }] });
  const ls = await ok(pg, `belege/${ab.id}/weiter`, { ziel: 'LS' });
  const pos = ls.positionen.filter(p => p.artikel_id === art.id);
  expect(pos.map(p => [p.menge, p.charge_nr])).toEqual([[3000, 'A1/P1/B1/P2/LS9']]);
});
