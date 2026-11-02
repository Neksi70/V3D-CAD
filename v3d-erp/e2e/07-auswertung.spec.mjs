// F08 Tagesblick der Geschäftsführung + Handybreite
import { test, expect, ok, S, oeffne } from './hilfe.mjs';

test('F08-H1 Startseite mit Kennzahlen, Umsatz, Fälligkeiten', async ({ pg }) => {
  await oeffne(pg, '#/start', '.kpis');
  await expect(S(pg, '.kpis')).toContainText('€');
  await oeffne(pg, '#/umsatz', '.viz-svg');
  const u = await ok(pg, 'umsatz');
  await expect(S(pg, '.card').first()).toContainText(new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2 }).format(u.summe_jahr));
  await oeffne(pg, '#/op/debitor', 'table');
});

for (const seite of ['#/start', '#/belege/VK', '#/liquiditaet', '#/umsatz', '#/datev', '#/inventur', '#/produktion', '#/bank', '#/mahnwesen', '#/op/debitor', '#/chargen', '#/projekte']) {
  test(`F08-E1 Handybreite 390 px ohne seitliches Verschieben: ${seite}`, async ({ pg }) => {
    await pg.setViewportSize({ width: 390, height: 844 });
    await pg.goto('./' + seite); await pg.waitForTimeout(800);
    expect(await pg.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(392);
  });
}
