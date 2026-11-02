// F02 Angebot → Auftrag, F07 Korrektur nach Verarbeiten, Mehrfachklick, zwei Reiter
import { test, expect, api, ok, S, oeffne, beleg, erster } from './hilfe.mjs';

test('F02-H1 Angebot in der Oberfläche erfassen, verarbeiten, zur AB weiterverarbeiten', async ({ pg }) => {
  const k = await erster(pg, 'adressen?rolle=kunde');
  const a = await erster(pg, 'artikel');
  await pg.goto('./#/neu/AN'); await S(pg, '#kKnr').waitFor();
  await S(pg, '#kKnr').fill(k.kundennr); await S(pg, '#kKnr').dispatchEvent('change');
  await S(pg, '#pt tr[data-i="0"] .pA').fill(a.artikelnr); await S(pg, '#pt tr[data-i="0"] .pA').dispatchEvent('change');
  await S(pg, '#pt tr[data-i="0"] .pM').fill('250'); await S(pg, '#pt tr[data-i="0"] .pM').dispatchEvent('input');
  await S(pg, '#bVa').click();
  await expect(S(pg, '.bk-kasten')).toContainText(/AN-\d\d-\d{4}/);
  await expect(S(pg, '#bSp')).toHaveCount(0);                     // gesperrt
  await S(pg, '#wM .btn').click(); await S(pg, '#wM .ddl button').filter({ hasText: 'Auftragsbestätigung' }).click();
  await expect(S(pg, '.bk-titel')).toHaveText('Auftragsbestätigung');
  await S(pg, '#bVa').click();
  await expect(S(pg, '.bk-kasten')).toContainText(/AB-\d\d-\d{4}/);
  const id = +pg.url().split('/').pop();
  const ab = await ok(pg, 'belege/' + id);
  expect(ab.positionen.find(p => p.artikel_id === a.id).menge).toBe(250);
  expect(ab.kette.map(x => x.belegart)).toEqual(expect.arrayContaining(['AN', 'AB']));
});

test('F07-H1 verarbeitete Rechnung ist gesperrt, Korrektur nur per Gutschrift', async ({ pg }) => {
  const k = await erster(pg, 'adressen?rolle=kunde');
  const re_ = await beleg(pg, { belegart: 'RE', adresse_id: k.id, positionen: [{ text: 'Bohren', menge: 10, einzelpreis: 12 }] });
  const r = await api(pg, 'belege', { id: re_.id, belegart: 'RE', adresse_id: k.id, positionen: [{ text: 'manipuliert', menge: 1, einzelpreis: 1 }] });
  expect(r.http).toBe(400);
  expect(r.fehler).toContain('Gutschrift');
  await oeffne(pg, '#/beleg/' + re_.id, '#wM');
  await S(pg, '#wM .btn').click(); await S(pg, '#wM .ddl button').filter({ hasText: 'Gutschrift' }).click();
  await expect(S(pg, '.bk-titel')).toContainText('Gutschrift');
  await S(pg, '#bVa').click();
  await expect(S(pg, '.bk-kasten')).toContainText(/GS-\d\d-\d{4}/);
  const ops = (await ok(pg, 'op?art=debitor')).liste.filter(o => o.beleg_id === re_.id || o.nummer?.startsWith('GS'));
  expect(ops.length).toBeGreaterThan(0);
});

test('F02-E1 Doppelklick auf Verarbeiten vergibt nur eine Nummer', async ({ pg }) => {
  const k = await erster(pg, 'adressen?rolle=kunde');
  const b = await beleg(pg, { belegart: 'AN', adresse_id: k.id, positionen: [{ text: 'Doppelklick', menge: 1, einzelpreis: 5 }] }, false);
  await oeffne(pg, '#/beleg/' + b.id, '#bVa');
  await S(pg, '#bVa').dblclick();
  await expect(S(pg, '.bk-kasten')).toContainText(/AN-\d\d-\d{4}/);
  const nr = (await ok(pg, 'belege/' + b.id)).nummer;
  const n2 = await beleg(pg, { belegart: 'AN', adresse_id: k.id, positionen: [{ text: 'danach', menge: 1, einzelpreis: 5 }] });
  const lfd = s => +s.split('-').pop();
  expect(lfd(n2.nummer)).toBe(lfd(nr) + 1);                          // keine Lücke durch den zweiten Klick
});

test('F02-E2 zwei Reiter: Entwurf in Reiter 2 speichern, nachdem Reiter 1 verarbeitet hat', async ({ pg, context }) => {
  const k = await erster(pg, 'adressen?rolle=kunde');
  const b = await beleg(pg, { belegart: 'AN', adresse_id: k.id, positionen: [{ text: 'Zwei Reiter', menge: 1, einzelpreis: 5 }] }, false);
  const p2 = await context.newPage();
  await p2.goto('./#/beleg/' + b.id); await p2.locator('.seite.on #bSp').waitFor();
  await oeffne(pg, '#/beleg/' + b.id, '#bVa');
  await S(pg, '#bVa').click(); await expect(S(pg, '.bk-kasten')).toContainText(/AN-\d\d-\d{4}/);
  await p2.locator('.seite.on #pt tr[data-i="0"] .pT').fill('nachträglich geändert');
  await p2.locator('.seite.on #bSp').click();
  await expect(p2.locator('#toast')).toContainText('verarbeitet');
  expect((await ok(pg, 'belege/' + b.id)).positionen[0].text).toBe('Zwei Reiter');
  await p2.close();
});

test('F02-N1 Beleg ohne Kunde wird nicht gespeichert', async ({ pg }) => {
  await pg.goto('./#/neu/AN'); await S(pg, '#kKnr').waitFor();
  await S(pg, '#pt tr[data-i="0"] .pT').fill('ohne Kunde');
  await S(pg, '#bSp').click();
  await expect(pg.locator('#toast')).toContainText('Kunde');
});
