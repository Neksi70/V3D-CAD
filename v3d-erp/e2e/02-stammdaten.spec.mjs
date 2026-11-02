// F12 Stammdaten anlegen
import { test, expect, api, ok, S, oeffne } from './hilfe.mjs';

test('F12-H1 Kunde zugleich Lieferant anlegen: beide Nummern, Umlaute/Emoji bleiben erhalten', async ({ pg }) => {
  await oeffne(pg, '#/adressen/kunde/neu', '#a_name1');
  const name = 'Größenwahn & Söhne GmbH 🔩';
  await S(pg, '#a_name1').fill(name);
  await S(pg, '#a_ort').fill('Lüdenscheid');
  await S(pg, '#ad .reiter button[data-r="rollen"]').click();
  await S(pg, '#rK').check(); await S(pg, '#rL').check();
  await S(pg, '#aSp').click();
  await expect(pg.locator('#toast')).toContainText('Gespeichert');
  const a = (await api(pg, 'adressen?suche=Größenwahn')).liste[0];
  expect(a.name1).toBe(name);
  expect(a.kundennr).toMatch(/^\d+$/);
  expect(a.lieferantennr).toMatch(/^\d+$/);
});

test('F12-N1 ohne Namen wird nicht gespeichert', async ({ pg }) => {
  await oeffne(pg, '#/adressen/kunde/neu', '#a_name1');
  const vorher = (await api(pg, 'adressen')).liste.length;
  await S(pg, '#aSp').click();
  await expect(pg.locator('#toast')).toContainText('Name fehlt');
  expect((await api(pg, 'adressen')).liste.length).toBe(vorher);
});

test('F12-E1 sehr lange Eingabe: speicherbar, Liste bleibt bedienbar', async ({ pg }) => {
  const lang = 'Sehr langer Firmenname '.repeat(20);
  const a = await ok(pg, 'adressen', { name1: lang, kunde: {} });
  expect(a.name1).toBe(lang);
  expect(a.kurz.length).toBeLessThanOrEqual(30);
  await oeffne(pg, '#/adressen/kunde', '#al tr[data-id]');
  await expect(S(pg, '#al')).toBeVisible();
});

test('F12-N2 Adresse mit Belegen lässt sich nicht löschen', async ({ pg }) => {
  const b = (await api(pg, 'belege?bereich=VK')).liste.find(x => x.status === 'verarbeitet');
  const beleg = await ok(pg, 'belege/' + b.id);
  const r = await api(pg, 'adressen/' + beleg.adresse_id, undefined, 'DELETE');
  expect(r.http).toBe(400);
  expect(r.fehler).toContain('Belege');
});

test('F12-E2 Artikel mit Arbeitsplan (Toleranz, Prüfschritt) speichern und wieder lesen', async ({ pg }) => {
  await oeffne(pg, '#/artikel/neu', '#r_bezeichnung');
  await S(pg, '#r_bezeichnung').fill('Ventilgehäuse E2E');
  await S(pg, '#ard .reiter button[data-r="aplan"]').click();
  await S(pg, '#apNeu').click();
  const z = S(pg, '#apL tr').last();
  await z.locator('.apNr').fill('AG000019'); await z.locator('.apT').fill('Nut fräsen'); await z.locator('.apTol').fill('12 mm ±0,1'); await z.locator('.apP').check();
  await S(pg, '#rSp').click();
  await expect(pg.locator('#toast')).toContainText('Gespeichert');
  const a = (await api(pg, 'artikel?suche=Ventilgehäuse E2E')).liste[0];
  const d = await ok(pg, 'artikel/' + a.id);
  expect(d.arbeitsplan_liste).toEqual([{ nr: 'AG000019', text: 'Nut fräsen', toleranz: '12 mm ±0,1', pruef: true }]);
});
