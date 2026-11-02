// F03 Einkaufskette: Bestellung → Wareneingang (Lager +) → Rechnungseingang (Kreditoren-OP)
import { test, expect, api, ok, S, oeffne, beleg, erster } from './hilfe.mjs';

test('F03-H1 Bestellung → Wareneingang → Rechnungseingang', async ({ pg }) => {
  const lf = await erster(pg, 'adressen?rolle=lieferant');
  const art = await ok(pg, 'artikel', { bezeichnung: 'Bohrer HSS 6,8 E2E', ek_preis: 4.2, lagerfuehrung: 1 });
  const vorher = (await ok(pg, 'artikel/' + art.id)).bestand;
  const be = await beleg(pg, { belegart: 'BE', adresse_id: lf.id, positionen: [{ artikel_id: art.id, menge: 20, einzelpreis: 4.2 }] });
  await oeffne(pg, '#/beleg/' + be.id, '#wM');
  await S(pg, '#wM .btn').click(); await S(pg, '#wM .ddl button').filter({ hasText: 'Wareneingang' }).click();
  await S(pg, '#bVa').waitFor(); await S(pg, '#bVa').click();
  await expect(S(pg, '.bk-kasten')).toContainText(/WE-\d\d-\d{4}/);
  expect((await ok(pg, 'artikel/' + art.id)).bestand).toBe(vorher + 20);
  await S(pg, '#wM .btn').click(); await S(pg, '#wM .ddl button').filter({ hasText: 'Rechnungseingang' }).click();
  await S(pg, '#bVa').waitFor(); await S(pg, '#bVa').click();
  await expect(S(pg, '.bk-kasten')).toContainText(/ER-\d\d-\d{4}/);
  const erId = +pg.url().split('/').pop();
  const op = (await ok(pg, 'op?art=kreditor')).liste.find(o => o.beleg_id === erId);
  expect(op.offen).toBeCloseTo(99.96, 2);                                   // 84,00 + 19 %
});

test('F03-N1 Einkaufsbeleg für eine Adresse ohne Lieferantenrolle wird abgelehnt', async ({ pg }) => {
  const nurKunde = await ok(pg, 'adressen', { name1: 'Nur Kunde E2E', kunde: {} });
  const r = await api(pg, 'belege', { belegart: 'BE', adresse_id: nurKunde.id, positionen: [{ text: 'x', menge: 1, einzelpreis: 1 }] });
  expect(r.http).toBe(400);
  expect(r.fehler).toContain('kein Lieferant');
});
