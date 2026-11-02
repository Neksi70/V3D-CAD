// Inventur: eröffnen → zählen → abschließen
import { test, expect, ok, api, S, oeffne } from './hilfe.mjs';

test('INV-H1 Inventur in der Oberfläche, Differenz wird gebucht', async ({ pg }) => {
  const art = await ok(pg, 'artikel', { bezeichnung: 'Zählartikel E2E', ek_preis: 2, lagerfuehrung: 1, gruppe: 'E2E-Inventur' });
  await oeffne(pg, '#/inventur', '#ivNeu');
  await S(pg, '#ivG').selectOption('E2E-Inventur');
  await S(pg, '#ivNeu').click();
  await S(pg, '#ivL tr').first().waitFor();
  await expect(S(pg, '#ivL tr')).toHaveCount(1);
  await S(pg, '#ivL tr .ivI').fill('7'); await S(pg, '#ivL tr .ivI').dispatchEvent('input');
  await expect(S(pg, '#ivL tr .ivD')).toHaveText('+7');
  await S(pg, '#ivFertig').click();
  await expect(pg.locator('#toast')).toContainText('1 Differenz');
  expect((await ok(pg, 'artikel/' + art.id)).bestand).toBe(7);
  const iid = +pg.url().split('/').pop();
  const r = await api(pg, `inventuren/${iid}/zaehlen`, { werte: [] });
  expect(r.http).toBe(400);                                                  // INV-N1 abgeschlossen = gesperrt
});
