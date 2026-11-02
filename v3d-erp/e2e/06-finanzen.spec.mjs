// F04 Sammelrechnung, F05 Zahlungsabgleich, F06 Mahnlauf, Liquidität, DATEV, F11 E-Rechnung mit Steuerfall
import { test, expect, api, ok, S, oeffne, beleg, erster } from './hilfe.mjs';

test('F04-H1 Rechnung aus mehreren Lieferscheinen', async ({ pg }) => {
  const k = await ok(pg, 'adressen', { name1: 'Sammelrechnung E2E', kunde: {} });
  for (const t of ['LS eins', 'LS zwei']) await beleg(pg, { belegart: 'LS', adresse_id: k.id, positionen: [{ text: t, menge: 1, einzelpreis: 100 }] });
  await oeffne(pg, '#/belege/VK', '#srNeu');
  await S(pg, '#srNeu').click();
  await pg.locator(`#dBody [data-kr="${k.id}"]`).click();
  await pg.locator('#dFuss .btn.pri').click();
  await S(pg, '#bMn').waitFor();
  const re_ = await ok(pg, 'belege/' + pg.url().split('/').pop());
  expect(re_.belegart).toBe('RE');
  expect(re_.netto).toBe(200);
});

test('F05-H1 Kontoauszug einlesen und sichere Zahlungen zuordnen', async ({ pg }) => {
  const opVorher = (await ok(pg, 'op?art=debitor')).liste.reduce((s, o) => s + o.offen, 0);
  const csv = await (await pg.request.get('api/bank/beispiel.csv')).body();
  await oeffne(pg, '#/bank', '#bkF');
  await S(pg, '#bkF').setInputFiles({ name: 'auszug.csv', mimeType: 'text/csv', buffer: csv });
  await expect(pg.locator('#toast')).toContainText('eingelesen');
  await S(pg, '#bkAlle').click();
  await expect(pg.locator('#toast')).toContainText('automatisch zugeordnet');
  const opNachher = (await ok(pg, 'op?art=debitor')).liste.reduce((s, o) => s + o.offen, 0);
  expect(opNachher).toBeLessThan(opVorher);
  // F05-E1 derselbe Auszug noch einmal: nichts doppelt
  await S(pg, '#bkF').setInputFiles({ name: 'auszug.csv', mimeType: 'text/csv', buffer: csv });
  await expect(pg.locator('#toast')).toContainText('schon vorhanden');
});

test('F06-H1 Mahnlauf erzeugt Mahnung als PDF', async ({ pg }) => {
  const k = await ok(pg, 'adressen', { name1: 'Säumig E2E', kunde: {} });
  const alt = new Date(Date.now() - 70 * 864e5).toISOString().slice(0, 10);
  await beleg(pg, { belegart: 'RE', adresse_id: k.id, datum: alt, positionen: [{ text: 'alt', menge: 1, einzelpreis: 50 }] });
  await oeffne(pg, '#/mahnwesen', '#mwOk');
  await expect(S(pg, '#mwI')).toContainText('SÄUMIG E2E');
  await S(pg, '#mwAlle').uncheck();
  await S(pg, `.mwK[value="${k.id}"]`).check();
  await S(pg, '#mwOk').click();
  await expect(pg.locator('#dlg[open]')).toContainText('Mahnungen erstellt');
  const m = (await ok(pg, 'mahnungen')).liste.find(x => x.kurz === k.kurz);
  const pdf = await pg.request.get(`api/mahnungen/${m.id}/pdf`);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
});

test('LIQ-H1 Liquidität: Kontostand + feste Zahlung ergeben die Wochenstände', async ({ pg }) => {
  await oeffne(pg, '#/liquiditaet', '#lqB');
  await S(pg, '#lqB').fill('10.000,00'); await S(pg, '#lqSp').click();
  await expect(pg.locator('#toast')).toContainText('Kontostand');
  const l = await ok(pg, 'liquiditaet?wochen=13');
  expect(l.kontostand).toBe(10000);
  expect(l.wochen.at(-1).stand).toBeCloseTo(10000 + l.wochen.reduce((s, w) => s + w.saldo, 0), 2);
  const r = await api(pg, 'liquiditaet/posten', { posten: [{ text: 'kaputt', betrag: 1, rhythmus: 'monatlich', erster: '31.12.2026' }] });
  expect(r.http).toBe(400);                                                  // LIQ-N1 falsches Datumsformat
});

test('DATEV-H1 Export nur mit Berater-/Mandantennummer, dann EXTF-Datei', async ({ pg }) => {
  const h = new Date().getFullYear();
  await oeffne(pg, '#/datev', '#dvBe');
  await S(pg, '#dvV').fill(`${h}-01-01`); await S(pg, '#dvB').fill(`${h}-12-31`);
  await S(pg, '#dvVs').click();
  await expect(S(pg, '#dvErg')).toContainText('Berater- und Mandantennummer fehlen');
  await S(pg, '#dvBe').fill('1234567'); await S(pg, '#dvMa').fill('10001'); await S(pg, '#dvSp').click();
  await expect(pg.locator('#toast')).toContainText('gespeichert');
  await S(pg, '#dvV').fill(`${h}-01-01`); await S(pg, '#dvB').fill(`${h}-12-31`);
  const [dl] = await Promise.all([pg.waitForEvent('download'), S(pg, '#dvEx').click()]);
  const text = (await require_fs()).readFileSync(await dl.path()).toString('latin1');
  expect(text.split('\r\n')[0]).toMatch(/^"EXTF";700;21;"Buchungsstapel"/);
  expect(text.split('\r\n').length).toBeGreaterThan(3);
});
const require_fs = () => import('fs');

test('F11-H1 Rechnung an EU-Kunden: 0 % USt, Hinweis, XRechnung mit Kategorie AE', async ({ pg }) => {
  await ok(pg, 'einstellungen', { email: 'info@test.example', iban: 'DE02120300000000202051', telefon: '02331 0', ust_id: 'DE123456789' });
  const k = await ok(pg, 'adressen', { name1: 'Wiener Teile GmbH', strasse: 'Ring 1', plz: '1010', ort: 'Wien', land: 'AT', ust_id: 'ATU12345678',
    email: 'ap@wien.example', kunde: { steuerfall: 'eu_leistung' } });
  await pg.goto('./#/neu/RE'); await S(pg, '#kKnr').waitFor();
  await S(pg, '#kKnr').fill(k.kunde.kundennr); await S(pg, '#kKnr').dispatchEvent('change');
  await S(pg, '#pt tr[data-i="0"] .pT').fill('Lohnbearbeitung'); await S(pg, '#pt tr[data-i="0"] .pP').fill('500'); await S(pg, '#pt tr[data-i="0"] .pP').dispatchEvent('input');
  await expect(S(pg, '#sS')).toHaveText('0,00 €');
  await expect(S(pg, '#sfHinweis')).toContainText('Reverse Charge');
  await S(pg, '#bVa').click();
  await expect(S(pg, '.bk-kasten')).toContainText(/RE-\d\d-\d{4}/);
  const id = pg.url().split('/').pop();
  const xml = await (await pg.request.get(`api/belege/${id}/xrechnung`)).text();
  expect(xml).toContain('<ram:CategoryCode>AE</ram:CategoryCode>');
  expect(xml).toContain('VATEX-EU-AE');
  // F11-N1 Steuerfall EU ohne USt-IdNr. lässt sich nicht verarbeiten
  const ohne = await ok(pg, 'adressen', { name1: 'Ohne UStID', land: 'NL', kunde: { steuerfall: 'eu_lieferung' } });
  const b = await ok(pg, 'belege', { belegart: 'RE', adresse_id: ohne.id, positionen: [{ text: 'x', menge: 1, einzelpreis: 1 }] });
  const r = await api(pg, `belege/${b.id}/verarbeiten`, {});
  expect(r.http).toBe(400); expect(r.fehler).toContain('USt-IdNr');
});

test('F11-E1 eigene XRechnung als Rechnungseingang einlesen, zweites Mal als Dublette erkannt', async ({ pg }) => {
  const re_ = (await ok(pg, 'belege?bereich=VK&belegart=RE')).liste.find(x => x.status === 'verarbeitet' && x.nummer);
  const x = await pg.request.get(`api/belege/${re_.id}/xrechnung`);
  if (!x.ok()) test.skip(true, 'Rechnung ohne vollständige Pflichtangaben');
  const daten = (await x.body()).toString('base64');
  const r1 = await api(pg, 'erechnung/einlesen', { name: 'r.xml', daten });
  expect(r1.http).toBe(200);
  const r2 = await api(pg, 'erechnung/einlesen', { name: 'r.xml', daten });
  expect(r2.http).toBe(400);
});

test('F06-E1 Mahnsperre-Häkchen in Offene Posten stehen normal in der Zeile (BUG-005)', async ({ pg }) => {
  await oeffne(pg, '#/op/debitor', 'table');
  const h = S(pg, 'input[type=checkbox][data-id]').first();
  await expect(h).toBeVisible();
  expect(await h.evaluate(e => [getComputedStyle(e).position, getComputedStyle(e).transform])).toEqual(['static', 'none']);
  await h.check();
  await expect(pg.locator('#toast')).toBeVisible();
});
