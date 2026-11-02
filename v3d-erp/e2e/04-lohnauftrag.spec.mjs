// F01 Lohnauftrag: AB → Wareneingang Kundenmaterial (Charge für alle, Mindermenge) → Lieferschein (Charge automatisch) → Rechnung
import { test, expect, api, ok, S, oeffne, beleg, erster } from './hilfe.mjs';

test('F01-H1 Lohnauftrag von der AB bis zur Rechnung, Klicks gezählt', async ({ pg }) => {
  const k = await erster(pg, 'adressen?rolle=kunde');
  const art = await ok(pg, 'artikel', { bezeichnung: 'Ventilgehäuse Nut fräsen', vk_preis: 0.6325, lagerfuehrung: 0 });
  const ab = await beleg(pg, { belegart: 'AB', adresse_id: k.id, ihre_referenz: '400003572', positionen: [{ artikel_id: art.id, menge: 3830, einzelpreis: 0.6325 }] });
  let klicks = 0; const klick = async l => { klicks++; await l.click(); };
  // Wareneingang Kundenmaterial
  await oeffne(pg, '#/beleg/' + ab.id, '#wM');
  await klick(S(pg, '#wM .btn')); await klick(S(pg, '#wM .ddl button').filter({ hasText: 'Wareneingang Kundenmaterial' }));
  await S(pg, '#chAlle').waitFor();
  await S(pg, '#pt tr[data-i="0"] .pM').fill('3750'); await S(pg, '#pt tr[data-i="0"] .pM').dispatchEvent('input');   // Mindermenge
  await S(pg, '#chAlle').fill('400003572/50/160022690/10/74548'); await klick(S(pg, '#chAlleB'));
  await klick(S(pg, '#bVa'));
  await expect(pg.locator('#dlg[open]')).toContainText('weicht');                    // Abgleich-Dialog Mindermenge
  await klick(pg.locator('#dFuss .btn.pri'));
  await expect.poll(async () => (await ok(pg, 'belege/' + ab.id)).positionen[0].menge).toBe(3750);   // AB einmal angeglichen, nicht 3× von Hand
  // Lieferschein aus der AB, Charge automatisch
  await oeffne(pg, '#/beleg/' + ab.id, '#wM');
  await klick(S(pg, '#wM .btn')); await klick(S(pg, '#wM .ddl button').filter({ hasText: 'Lieferschein' }));
  await S(pg, '#bVa').waitFor();
  await klick(S(pg, '#bVa'));
  await expect(S(pg, '.bk-kasten')).toContainText(/LS-\d\d-\d{4}/);
  const lsId = +pg.url().split('/').pop();
  const ls = await ok(pg, 'belege/' + lsId);
  const lsPos = ls.positionen.find(p => p.artikel_id === art.id);
  expect(lsPos.charge_nr).toBe('400003572/50/160022690/10/74548');
  expect(lsPos.menge).toBe(3750);
  // Rechnung aus dem Lieferschein
  await klick(S(pg, '#wM .btn')); await klick(S(pg, '#wM .ddl button').filter({ hasText: 'Rechnung' }));
  await S(pg, '#bVa').waitFor(); await klick(S(pg, '#bVa'));
  await expect(S(pg, '.bk-kasten')).toContainText(/RE-\d\d-\d{4}/);
  const reId = +pg.url().split('/').pop();
  const re_ = await ok(pg, 'belege/' + reId);
  expect(re_.positionen.find(p => p.artikel_id === art.id).charge_nr).toBe(lsPos.charge_nr);
  const pdf = await pg.request.get(`api/belege/${reId}/pdf`);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  test.info().annotations.push({ type: 'klicks', description: `F01 AB→WK→LS→RE: ${klicks} Klicks (myfactory laut Video ~30 nur bis LS)` });
  console.log('F01-Klicks', klicks);
  expect(klicks).toBeLessThanOrEqual(15);
});

test('F01-N1 Lieferschein über mehr als im Haus ist gesperrt', async ({ pg }) => {
  const k = await erster(pg, 'adressen?rolle=kunde');
  const art = await ok(pg, 'artikel', { bezeichnung: 'Ritzel honen', vk_preis: 0.07, lagerfuehrung: 0 });
  const ab = await beleg(pg, { belegart: 'AB', adresse_id: k.id, positionen: [{ artikel_id: art.id, menge: 1000, einzelpreis: 0.07 }] });
  const wk = await ok(pg, `belege/${ab.id}/weiter`, { ziel: 'WK' });
  wk.positionen.forEach(p => { p.charge_nr = 'CH-RIT'; p.menge = 500; });
  const w = await ok(pg, 'belege', wk); await ok(pg, `belege/${w.id}/verarbeiten`, {});
  const ls = await ok(pg, `belege/${ab.id}/weiter`, { ziel: 'LS' });
  ls.positionen.filter(p => p.charge_id).forEach(p => { p.menge = 800; });
  const l = await ok(pg, 'belege', ls);
  const r = await api(pg, `belege/${l.id}/verarbeiten`, {});
  expect(r.http).toBe(400);
  expect(r.fehler).toMatch(/nur 500/);
});

test('F01-E1 Sammel-Lieferschein über zwei Aufträge eines Kunden', async ({ pg }) => {
  const k = await ok(pg, 'adressen', { name1: 'Sammelkunde E2E', kunde: {} });
  const art = await ok(pg, 'artikel', { bezeichnung: 'Lagerdeckel E2E', vk_preis: 0.5, lagerfuehrung: 0 });
  for (const ch of ['CH-A', 'CH-B']) {
    const ab = await beleg(pg, { belegart: 'AB', adresse_id: k.id, positionen: [{ artikel_id: art.id, menge: 100, einzelpreis: 0.5 }] });
    const wk = await ok(pg, `belege/${ab.id}/weiter`, { ziel: 'WK' }); wk.positionen.forEach(p => { p.charge_nr = ch; });
    const w = await ok(pg, 'belege', wk); await ok(pg, `belege/${w.id}/verarbeiten`, {});
  }
  await oeffne(pg, '#/belege/VK', '#slNeu');
  await S(pg, '#slNeu').click();
  await pg.locator(`#dBody [data-k="${k.id}"]`).click();
  await pg.locator('#dBody .slH').first().waitFor();
  for (const c of await pg.locator('#dBody .slH').all()) await c.check();
  await pg.locator('#dFuss .btn.pri').click();
  await S(pg, '#bMn').waitFor();
  const ls = await ok(pg, 'belege/' + pg.url().split('/').pop());
  expect(ls.positionen.filter(p => p.charge_nr).map(p => p.charge_nr).sort()).toEqual(['CH-A', 'CH-B']);
});
