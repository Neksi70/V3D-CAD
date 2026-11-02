// F09 Werkstatt meldet zurück, F10 Kunde fragt nach dem Termin (Zeitstrahl-PDF)
import { test as roh } from '@playwright/test';
import { test, expect, api, ok, S, oeffne, beleg, erster, anmelden } from './hilfe.mjs';

test('F09-H1 Palette starten und fertigmelden, Ausschuss geht auf die Charge', async ({ pg, browser }) => {
  const k = await erster(pg, 'adressen?rolle=kunde');
  const art = await ok(pg, 'artikel', { bezeichnung: 'Werkstatt E2E', vk_preis: 1, lagerfuehrung: 0, arbeitsplan: [{ text: 'Bohren' }] });
  const ab = await beleg(pg, { belegart: 'AB', adresse_id: k.id, positionen: [{ artikel_id: art.id, menge: 100, einzelpreis: 1 }] });
  const wk = await ok(pg, `belege/${ab.id}/weiter`, { ziel: 'WK' }); wk.positionen.forEach(p => { p.charge_nr = 'CH-WS'; });
  const w = await ok(pg, 'belege', wk); await ok(pg, `belege/${w.id}/verarbeiten`, {});
  const charge = (await ok(pg, 'chargen?q=CH-WS')).liste.find(c => c.chargennr === 'CH-WS');
  const ctx = await browser.newContext(); const t = await ctx.newPage(); await anmelden(t, 'werkstatt');
  const f = await ok(t, 'produktion/start', { charge_id: charge.id, arbeitsgang: 'Bohren', menge_plan: 100 });
  await ok(t, `fertigung/${f.id}/beenden`, { menge_gut: 97, menge_ausschuss: 3, freigabe: true });
  await t.goto('./'); await expect(t.locator('body')).toContainText('Produktion');
  await ctx.close();
  const c = await ok(pg, 'chargen/' + charge.id);
  expect(JSON.stringify(c)).toContain('ausschuss');
});

test('F10-H1 Projekt mit Zeitstrahl: Kunden-PDF abrufbar', async ({ pg }) => {
  const p = (await ok(pg, 'projekte')).liste[0];
  await oeffne(pg, '#/projekt/' + p.id, '#gi');
  const pdf = await pg.request.get(`api/projekte/${p.id}/bericht.pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
});
