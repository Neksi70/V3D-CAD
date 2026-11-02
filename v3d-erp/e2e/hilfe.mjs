// Gemeinsame Hilfen: angemeldete Seite, Fehlerfänger (Konsole, Seitenfehler, 5xx), API-Zugriff, aktive Seite.
import { test as basis, expect } from '@playwright/test';

export async function anmelden(page, login = 'demo', pw = login) {
  const r = await page.request.post('api/login', { data: { login, passwort: pw } });
  expect(r.ok(), `Anmeldung ${login}`).toBeTruthy();
}

export const test = basis.extend({
  fehler: async ({}, use) => { await use([]); },
  pg: async ({ page, fehler }, use) => {
    page.on('pageerror', e => fehler.push('Seitenfehler: ' + e.message));
    // 4xx sind erwartete Fachantworten (Meldung im Toast) – der Browser loggt sie trotzdem; 5xx fängt der response-Handler
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource: .*status of 4\d\d/.test(m.text())) fehler.push('Konsole: ' + m.text()); });
    page.on('response', r => { if (r.status() >= 500) fehler.push(`HTTP ${r.status()} ${r.url()}`); });
    page.on('dialog', d => d.accept());
    await anmelden(page);
    await use(page);
    expect(fehler, 'keine Konsolen-/Seitenfehler und keine 5xx').toEqual([]);
  },
});
export { expect };

/** JSON-API wie die Oberfläche (CSRF-Kopf X-ERP). */
export async function api(page, pfad, body, methode) {
  const opt = { headers: { 'X-ERP': '1' } };
  const r = body !== undefined || methode === 'POST'
    ? await page.request.post('api/' + pfad, { ...opt, data: body ?? {} })
    : await page.request.fetch('api/' + pfad, { ...opt, method: methode || 'GET' });
  const d = await r.json().catch(() => ({}));
  return { ...(Array.isArray(d) ? { liste: d } : d), http: r.status() };
}
export const ok = async (page, pfad, body) => { const r = await api(page, pfad, body); expect(r.http, `${pfad}: ${r.fehler || ''}`).toBe(200); return r; };

/** Locator in der aktiven Reiterseite (mehrere Reiter liegen gleichzeitig im DOM). */
export const S = (page, sel) => page.locator('.seite.on ' + sel);
export const toast = page => page.locator('#toast');
export async function oeffne(page, hash, warteAuf) {
  await page.goto('./' + hash);
  if (warteAuf) await S(page, warteAuf).first().waitFor({ state: 'attached' });
}
/** Neuer Verkaufs-/Einkaufsbeleg per API, optional verarbeitet. */
export async function beleg(page, d, verarbeiten = true) {
  const b = await ok(page, 'belege', d);
  return verarbeiten ? (await ok(page, `belege/${b.id}/verarbeiten`, {})).beleg : b;
}
export async function erster(page, pfad) { return (await ok(page, pfad)).liste[0]; }
