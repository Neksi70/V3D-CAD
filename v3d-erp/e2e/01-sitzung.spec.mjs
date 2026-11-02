// Anmeldung, Sitzung, Rechte (F01–F12 querschnittlich): Fälle Q-N1 … Q-E5
import { test as roh, expect } from '@playwright/test';
import { test, api, S, oeffne, anmelden } from './hilfe.mjs';

roh('Q-N1 falsches Kennwort zeigt Meldung, kein Zugang', async ({ page }) => {
  await page.goto('./');
  await page.getByPlaceholder('Benutzer').fill('demo');
  await page.getByPlaceholder('Kennwort').fill('falsch');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible();
  const r = await page.request.get('api/belege');
  expect(r.status()).toBe(401);
});

roh('Q-H1 Anmelden über das Formular öffnet die Startseite', async ({ page }) => {
  await page.goto('./');
  await page.getByPlaceholder('Benutzer').fill('demo');
  await page.getByPlaceholder('Kennwort').fill('demo');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.locator('.seite.on .kpis')).toBeVisible();
});

test('Q-E1 abgelaufene Sitzung führt zurück zur Anmeldung', async ({ pg, context }) => {
  await oeffne(pg, '#/belege/VK', '#bl tr');
  await context.clearCookies();
  await pg.goto('./#/belege/EK');
  await expect(pg.getByRole('button', { name: 'Anmelden' })).toBeVisible();
});

roh('Q-N2 Werkstatt-Tablet darf keine Belege lesen oder schreiben', async ({ page }) => {
  await anmelden(page, 'werkstatt');
  for (const [m, p] of [['GET', 'belege'], ['GET', 'adressen'], ['GET', 'datev/vorschau?von=2026-01-01&bis=2026-12-31'], ['POST', 'inventuren']]) {
    const r = m === 'GET' ? await page.request.get('api/' + p) : await page.request.post('api/' + p, { headers: { 'X-ERP': '1' }, data: {} });
    expect(r.status(), `${m} ${p}`).toBe(403);
  }
  expect((await page.request.get('api/werkstatt')).status()).toBe(200);
});

test('Q-N3 POST ohne CSRF-Kopf wird abgelehnt', async ({ pg }) => {
  const r = await pg.request.post('api/adressen', { data: { name1: 'Fremd' } });
  expect(r.status()).toBe(403);
});

test('Q-N4 gelöschter / unbekannter Beleg: Meldung statt Absturz', async ({ pg }) => {
  expect((await api(pg, 'belege/999999')).http).toBe(400);
  await pg.goto('./#/beleg/999999');
  await expect(pg.locator('#toast')).toContainText('nicht gefunden');
});

test('Q-E2 Neuladen mitten im Beleg behält den Beleg', async ({ pg }) => {
  const b = (await api(pg, 'belege?bereich=VK')).liste[0];
  await oeffne(pg, '#/beleg/' + b.id, '.bk-kasten');
  await pg.reload();
  await expect(S(pg, '.bk-kasten')).toContainText(b.nummer || 'beim Verarbeiten');
});

test('Q-E3 Zurück-Taste mitten in der Erfassung führt ohne Fehler zurück', async ({ pg }) => {
  await oeffne(pg, '#/belege/VK', '#bl tr');
  await pg.goto('./#/neu/AN'); await S(pg, '#kKnr').waitFor();
  await S(pg, '#pt tr[data-i="0"] .pT').fill('angefangen');
  await pg.goBack();
  await expect(S(pg, '#bl')).toBeVisible();
});

test('Q-E4 Tastatur: Alt+S speichert einen Belegentwurf', async ({ pg }) => {
  const k = (await api(pg, 'adressen?rolle=kunde')).liste[0];
  await pg.goto('./#/neu/AN'); await S(pg, '#kKnr').waitFor();
  await S(pg, '#kKnr').fill(k.kundennr); await S(pg, '#kKnr').dispatchEvent('change');
  await S(pg, '#pt tr[data-i="0"] .pT').fill('Tastaturtest');
  await pg.keyboard.press('Alt+s');
  await expect(pg.locator('#toast')).toContainText('Gespeichert');
  await expect(pg).toHaveURL(/#\/beleg\/\d+/);
});

test('Q-E5 Formularfelder haben zugeordnete Beschriftungen (Barrierefreiheit)', async ({ pg }) => {
  await oeffne(pg, '#/adressen/kunde/neu', '#a_name1');
  // Die Felder stehen unter einem <label>, sind ihm aber nicht zugeordnet (kein for=/umschließendes label)
  await expect(pg.getByLabel('Name', { exact: true })).toHaveCount(1);
});
