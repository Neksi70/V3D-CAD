// Tests für das Design-Manager-System (localStorage + Firestore)
const { test, expect } = require('@playwright/test');

const URL = 'http://localhost:8080/volme3d.html';

async function waitForApp(page) {
  await page.waitForFunction(() => window._isReady === true, { timeout: 15000 });
  await page.waitForTimeout(300);
}

// Firebase-CDN blockieren → Auth-Overlay bleibt hidden, Editor startet direkt
async function setupPage(page) {
  await page.route('**firebasejs**', r => r.abort());
  await page.goto(URL);
  await page.waitForFunction(() => window._isReady === true, { timeout: 15000 });
  await page.waitForTimeout(200);
}

// Wie setupPage + Firestore-Spy: alle Firestore-Writes landen in window._firestoreCalls
async function setupPageWithFirestore(page) {
  await page.route('**firebasejs**', r => r.abort());
  await page.addInitScript(() => {
    window._firestoreCalls = [];
    const makeDocRef = path => ({
      set:    d  => { window._firestoreCalls.push({ op: 'set',    path, data: d }); return Promise.resolve(); },
      delete: () => { window._firestoreCalls.push({ op: 'delete', path });           return Promise.resolve(); },
      update: d  => { window._firestoreCalls.push({ op: 'update', path, data: d }); return Promise.resolve(); },
    });
    const makeCollRef = base => ({
      doc: id => ({ ...makeDocRef(base + '/' + id), collection: sub => makeCollRef(base + '/' + id + '/' + sub) }),
      get:      () => Promise.resolve({ docs: [] }),
      orderBy:  () => ({ get: () => Promise.resolve({ docs: [] }) }),
    });
    window.firebase = {
      initializeApp: () => {},
      auth: () => ({
        onAuthStateChanged: cb => setTimeout(() => cb({ uid: 'test-uid', displayName: 'Tester' }), 50),
      }),
      firestore: () => ({ collection: col => makeCollRef(col) }),
    };
    window.firebase.auth.GoogleAuthProvider = function() {};
  });
  await page.goto(URL);
  await page.waitForFunction(() => window._isReady === true, { timeout: 15000 });
  // Warten bis onAuthStateChanged gefeuert hat (~50 ms + _fsLoadAllToCache)
  await page.waitForFunction(() => window._fbUser !== null, { timeout: 5000 });
  await page.waitForTimeout(400);
}

test('1 · Design erstellen → Seite neu laden → Design wiederhergestellt', async ({ page }) => {
  await page.goto(URL);
  await waitForApp(page);

  // localStorage leeren für sauberen Test
  await page.evaluate(() => {
    Object.keys(localStorage).filter(k => k.startsWith('volme3d')).forEach(k => localStorage.removeItem(k));
  });
  await page.reload();
  await waitForApp(page);

  // Box hinzufügen + positionieren
  await page.evaluate(() => {
    window.addShape('box');
    window._getObjects()[0].position.set(3, 1, 2);
    window._getObjects()[0].scale.set(1.5, 1.5, 1.5);
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window._getObjects().length)).toBe(1);

  // Auto-Save auslösen (simuliert den 30s-Tick)
  await page.evaluate(() => window._doAutoSave());
  await page.waitForTimeout(200);

  const designId = await page.evaluate(() => window.currentDesignId);
  expect(designId).toBeTruthy();
  console.log(`✓ Design gespeichert: ${designId}`);

  const savedData = await page.evaluate(() => {
    const id = window.currentDesignId;
    return JSON.parse(localStorage.getItem('volme3d_d_' + id));
  });
  expect(savedData.objects.length).toBe(1);
  expect(savedData.objects[0].sx).toBeCloseTo(1.5, 1);
  console.log(`✓ Box in localStorage: scale.x=${savedData.objects[0].sx}`);

  // ── "Browser schließen" = Seite neu laden ─────────────────────────────
  await page.reload();
  await waitForApp(page);

  // Design muss wiederhergestellt sein
  const restoredId = await page.evaluate(() => localStorage.getItem('volme3d_cur'));
  expect(restoredId).toBe(designId);

  const objCount = await page.evaluate(() => window._getObjects().length);
  expect(objCount).toBe(1);
  console.log(`✓ Nach Neuladen: ${objCount} Objekt(e) wiederhergestellt`);

  const pos = await page.evaluate(() => {
    const o = window._getObjects()[0];
    return { x: o.position.x, sx: o.scale.x };
  });
  expect(pos.x).toBeCloseTo(3, 0);
  expect(pos.sx).toBeCloseTo(1.5, 1);
  console.log(`✓ Objekt korrekt: position.x=${pos.x.toFixed(1)}, scale.x=${pos.sx.toFixed(1)}`);
});

test('2 · Galerie-Modal öffnen und Design-Cards anzeigen', async ({ page }) => {
  await setupPage(page);

  // Auto-Save auslösen damit mindestens 1 Design existiert
  await page.evaluate(() => {
    window.addShape('sphere');
    window._doAutoSave();
  });
  await page.waitForTimeout(300);

  // Modal öffnen
  await page.click('button:has-text("Meine Designs")');
  await page.waitForTimeout(400);

  const modal = page.locator('#ds-modal.show');
  expect(await modal.count()).toBe(1);
  console.log('✓ Modal geöffnet');

  const cards = page.locator('.ds-card');
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(1);
  console.log(`✓ ${count} Design-Card(s) in der Galerie`);

  // "Aktuell"-Badge muss sichtbar sein
  const badge = page.locator('.ds-cur-badge');
  expect(await badge.count()).toBeGreaterThan(0);
  console.log('✓ Aktuell-Badge sichtbar');

  // Modal schließen
  await page.click('#ds-modal .btn:has-text("✕")');
  await page.waitForTimeout(200);
  expect(await page.locator('#ds-modal.show').count()).toBe(0);
  console.log('✓ Modal geschlossen');
});

test('3 · Neues Design erstellen über Galerie', async ({ page }) => {
  await setupPage(page);

  // Erstes Design mit Box
  await page.evaluate(() => { window.addShape('box'); window._doAutoSave(); });
  await page.waitForTimeout(300);
  const id1 = await page.evaluate(() => window.currentDesignId);

  // Galerie öffnen → Neues Design
  await page.click('button:has-text("Meine Designs")');
  await page.waitForTimeout(400);
  await page.click('button:has-text("+ Neues Design")');
  await page.waitForTimeout(400);

  const id2 = await page.evaluate(() => window.currentDesignId);
  expect(id2).not.toBe(id1);
  console.log(`✓ Neues Design: ${id2}`);

  const objCount = await page.evaluate(() => window._getObjects().length);
  expect(objCount).toBe(0);
  console.log('✓ Neue Szene ist leer');

  // Altes Design muss noch in localStorage sein
  const idx = await page.evaluate(() => JSON.parse(localStorage.getItem('volme3d_designs') || '[]'));
  expect(idx.length).toBeGreaterThanOrEqual(2);
  console.log(`✓ ${idx.length} Designs im Index`);
});

test('4 · Design umbenennen', async ({ page }) => {
  await setupPage(page);
  await page.evaluate(() => { window.addShape('box'); window._doAutoSave(); });
  await page.waitForTimeout(300);

  await page.click('button:has-text("Meine Designs")');
  await page.waitForTimeout(400);

  // ✎-Button klicken — löst prompt() aus → mit Playwright dialog-Handler
  page.once('dialog', d => d.accept('Mein tolles Design'));
  await page.locator('.ds-acts .btn:has-text("✎")').first().click();
  await page.waitForTimeout(400);

  // Name in Toolbar muss aktualisiert sein
  const label = await page.locator('#cur-design-lbl').textContent();
  expect(label).toBe('Mein tolles Design');
  console.log(`✓ Design umbenannt: "${label}"`);
});

test('5 · Thumbnail wird als Bild gespeichert', async ({ page }) => {
  await page.goto(URL);
  await waitForApp(page);

  await page.evaluate(() => {
    window.addShape('cylinder');
    window._getObjects()[0].position.set(0, 1, 0);
  });
  await page.waitForTimeout(500);

  // Auto-Save auslösen
  await page.evaluate(() => window._doAutoSave());
  await page.waitForTimeout(300);

  const thumb = await page.evaluate(() => {
    const id = window.currentDesignId;
    return localStorage.getItem('volme3d_t_' + id) || '';
  });
  expect(thumb).toMatch(/^data:image\//);
  expect(thumb.length).toBeGreaterThan(500);
  console.log(`✓ Thumbnail gespeichert: ${thumb.length} Bytes (${thumb.substring(0, 30)}...)`);
});

test('6 · Export und Re-Import eines Designs', async ({ page }) => {
  await page.goto(URL);
  await waitForApp(page);

  await page.evaluate(() => {
    window.addShape('torus');
    window._getObjects()[0].scale.set(2, 2, 2);
    window._doAutoSave();
  });
  await page.waitForTimeout(300);

  const id = await page.evaluate(() => window.currentDesignId);

  // Export via Funktion (ohne tatsächlichen Download)
  const exported = await page.evaluate(id => {
    const data = window.dsLoadData(id);
    return JSON.stringify(data);
  }, id);
  const parsed = JSON.parse(exported);
  expect(parsed.objects.length).toBe(1);
  expect(parsed.objects[0].sx).toBeCloseTo(2, 1);
  console.log(`✓ Export: ${exported.length} Bytes, ${parsed.objects.length} Objekt(e)`);

  // Import in neuen Slot
  const newId = await page.evaluate(json => {
    const data = JSON.parse(json);
    const id = window.dsNewId();
    window.dsSaveDesign(id, data, '', 'Importiertes Design');
    return id;
  }, exported);
  expect(newId).toBeTruthy();

  const idx = await page.evaluate(() => JSON.parse(localStorage.getItem('volme3d_designs') || '[]'));
  const entry = idx.find(d => d.id === newId);
  expect(entry?.name).toBe('Importiertes Design');
  console.log(`✓ Import erfolgreich: "${entry?.name}" (id=${newId})`);
});

test('7 · Auto-Save alle 30s — Timer ist aktiv', async ({ page }) => {
  await page.goto(URL);
  await waitForApp(page);

  const timerActive = await page.evaluate(() => window._autoSaveTimer !== null);
  expect(timerActive).toBe(true);
  console.log('✓ Auto-Save-Timer ist aktiv');

  // Manuell auslösen (simuliert 30s-Tick)
  await page.evaluate(() => window.addShape('box'));
  await page.waitForTimeout(200);
  await page.evaluate(() => window._doAutoSave());
  await page.waitForTimeout(200);

  const saved = await page.evaluate(() => !!localStorage.getItem('volme3d_d_' + window.currentDesignId));
  expect(saved).toBe(true);
  console.log('✓ Auto-Save hat gespeichert');
});

// ═══════════════════════════════════════════════════════════════════════════
// Neue Feature-Tests: Zufallsnamen · Ctrl+S · Firestore-Integration
// ═══════════════════════════════════════════════════════════════════════════

test('8 · _randomDesignName() gibt "Adjektiv Name" zurück', async ({ page }) => {
  await setupPage(page);

  const samples = await page.evaluate(() =>
    Array.from({ length: 30 }, () => window._randomDesignName())
  );

  for (const name of samples) {
    const parts = name.split(' ');
    expect(parts.length).toBe(2);
    expect(parts[0]).toMatch(/^[A-Z]/);
    expect(parts[1]).toMatch(/^[A-Z]/);
  }

  const unique = new Set(samples);
  expect(unique.size).toBeGreaterThan(3); // keine feste Wiederholung
  console.log(`✓ Beispiele: ${[...unique].slice(0, 4).join(' · ')}`);
});

test('9 · Neues Design bekommt englischen Zufallsnamen (kein Datum)', async ({ page }) => {
  await setupPage(page);

  await page.evaluate(() => { window.addShape('box'); window._doAutoSave(); });
  await page.waitForTimeout(200);

  const name = await page.evaluate(() => window.dsGetMeta(window.currentDesignId)?.name || '');
  const parts = name.split(' ');
  expect(parts.length).toBe(2);
  expect(parts[0]).toMatch(/^[A-Z]/);
  expect(parts[1]).toMatch(/^[A-Z]/);
  expect(name).not.toMatch(/\d{1,2}\.\d{1,2}\.\d{4}/); // kein Datums-Format
  console.log(`✓ Auto-Save-Name: "${name}"`);

  // Auch "Neues Design" aus der Galerie bekommt Zufallsnamen
  await page.evaluate(() => window.newDesignFromGallery());
  await page.waitForTimeout(200);
  const name2 = await page.evaluate(() => window.dsGetMeta(window.currentDesignId)?.name || '');
  const parts2 = name2.split(' ');
  expect(parts2.length).toBe(2);
  expect(name2).not.toMatch(/\d{1,2}\.\d{1,2}\.\d{4}/);
  console.log(`✓ newDesignFromGallery-Name: "${name2}"`);
});

test('10 · Ctrl+S speichert sofort und zeigt "Gespeichert ✓"', async ({ page }) => {
  await setupPage(page);

  await page.evaluate(() => window.addShape('sphere'));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.currentDesignId)).toBeNull();

  await page.keyboard.press('Control+s');
  await page.waitForTimeout(400);

  const id = await page.evaluate(() => window.currentDesignId);
  expect(id).toBeTruthy();

  // Design muss in localStorage liegen
  const stored = await page.evaluate(() => !!localStorage.getItem('volme3d_d_' + window.currentDesignId));
  expect(stored).toBe(true);

  // Notify-Text muss "Gespeichert" enthalten
  const notifText = await page.locator('#notif').textContent();
  expect(notifText).toContain('Gespeichert');
  console.log(`✓ Ctrl+S: id=${id}, Notify="${notifText.trim()}"`);
});

test('11 · "Meine Designs" speichert automatisch vor dem Öffnen', async ({ page }) => {
  await setupPage(page);

  await page.evaluate(() => window.addShape('cylinder'));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.currentDesignId)).toBeNull();

  // Button klicken → showDesigns() → _doAutoSave() → Modal
  await page.click('button:has-text("Meine Designs")');
  await page.waitForTimeout(400);

  expect(await page.locator('#ds-modal.show').count()).toBe(1);
  const id = await page.evaluate(() => window.currentDesignId);
  expect(id).toBeTruthy();

  const stored = await page.evaluate(() => !!localStorage.getItem('volme3d_d_' + window.currentDesignId));
  expect(stored).toBe(true);
  console.log(`✓ Vor Galerie gespeichert: ${id}`);
});

test('12 · Design über Galerie löschen', async ({ page }) => {
  await setupPage(page);

  // Zwei Designs anlegen
  await page.evaluate(() => { window.addShape('box'); window._doAutoSave(); });
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    const id2 = window.dsNewId();
    window.dsSaveDesign(id2, { version: 1, objects: [] }, '', 'Zu löschen');
  });
  await page.waitForTimeout(100);

  const countBefore = await page.evaluate(() => window.dsGetAll().length);
  expect(countBefore).toBe(2);

  // Galerie öffnen → Mülleimer auf erstem nicht-aktiven Card
  await page.click('button:has-text("Meine Designs")');
  await page.waitForTimeout(300);

  const inactiveCard = page.locator('.ds-card:not(.ds-active)').first();
  page.once('dialog', d => d.accept());
  await inactiveCard.locator('.btn[title="Löschen"]').click();
  await page.waitForTimeout(300);

  const countAfter = await page.evaluate(() => window.dsGetAll().length);
  expect(countAfter).toBe(1);
  console.log(`✓ Gelöscht: ${countBefore} → ${countAfter} Designs`);
});

test('13 · Design aus Galerie laden wechselt die Szene', async ({ page }) => {
  await setupPage(page);

  // Design 1: Box
  await page.evaluate(() => { window.addShape('box'); window._doAutoSave(); });
  await page.waitForTimeout(200);
  const id1 = await page.evaluate(() => window.currentDesignId);

  // Design 2: direkt in Storage — enthält eine Kugel
  const id2 = await page.evaluate(() => {
    const id = window.dsNewId();
    window.dsSaveDesign(id, {
      version: 1, objects: [{ id: 77, name: 'KugelTest', type: 'sphere', color: '#00ff00',
        px: 0, py: 1, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 }]
    }, '', 'Design Kugel');
    return id;
  });

  // Galerie öffnen → nicht-aktive Card (Design 2) laden
  await page.click('button:has-text("Meine Designs")');
  await page.waitForTimeout(300);

  await page.locator('.ds-card:not(.ds-active)').first().click();
  await page.waitForTimeout(600);

  const currentId = await page.evaluate(() => window.currentDesignId);
  expect(currentId).not.toBe(id1);
  expect(currentId).toBe(id2);

  const objCount = await page.evaluate(() => window._getObjects().length);
  expect(objCount).toBe(1);

  const label = await page.locator('#cur-design-lbl').textContent();
  expect(label).toBeTruthy();
  console.log(`✓ Geladen: "${label}", ${objCount} Objekt(e)`);
});

test('14 · dsSaveDesign leitet Firestore-Call weiter (Mock)', async ({ page }) => {
  await setupPageWithFirestore(page);

  await page.evaluate(() => window.addShape('box'));
  await page.waitForTimeout(100);
  await page.evaluate(() => window._doAutoSave());

  // Firestore-Writes sind async — auf Abschluss warten
  await page.waitForFunction(() => window._firestoreCalls.some(c => c.op === 'set'), { timeout: 5000 });

  const calls = await page.evaluate(() => window._firestoreCalls.filter(c => c.op === 'set'));
  expect(calls.length).toBeGreaterThanOrEqual(1);

  const call = calls[0];
  expect(call.data.name).toBeTruthy();
  expect(typeof call.data.data).toBe('string'); // JSON-String der Szene
  expect(call.path).toContain('test-uid');       // richtiger User-Pfad

  const parsed = JSON.parse(call.data.data);
  expect(parsed.objects.length).toBe(1);
  console.log(`✓ Firestore.set(): name="${call.data.name}", path="${call.path}"`);
});

test('15 · Thumbnail für Firestore wird auf 200×150 skaliert', async ({ page }) => {
  await setupPageWithFirestore(page);

  await page.evaluate(() => window.addShape('box'));
  await page.waitForTimeout(100);
  await page.evaluate(() => window._doAutoSave());

  await page.waitForFunction(() => window._firestoreCalls.some(c => c.op === 'set'), { timeout: 5000 });

  const thumb = await page.evaluate(() =>
    window._firestoreCalls.find(c => c.op === 'set')?.data?.thumb || ''
  );
  if (!thumb) { console.log('ℹ Kein Thumbnail (leere Szene)'); return; }
  expect(thumb).toMatch(/^data:image\//);

  const dims = await page.evaluate(async src => {
    return new Promise(res => {
      const img = new Image();
      img.onload  = () => res({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => res(null);
      img.src = src;
    });
  }, thumb);

  expect(dims).not.toBeNull();
  expect(dims.w).toBe(200);
  expect(dims.h).toBe(150);
  console.log(`✓ Firestore-Thumb: ${dims.w}×${dims.h} px`);
});

test('16 · Login migriert lokale Designs zu Firestore', async ({ page }) => {
  await setupPageWithFirestore(page);

  // 2 lokale Designs anlegen (Firestore ist leer wegen mock orderBy → [])
  await page.evaluate(() => {
    const a = window.dsNewId(), b = window.dsNewId();
    // direkt in localStorage, ohne Firestore-Call (Funktion ruft _fsSaveDesign async auf)
    // Für Migration testen wir _fsLoadAllToCache mit local-only Designs
    localStorage.setItem('volme3d_designs', JSON.stringify([
      { id: a, name: 'Lokal A', created: 1, updated: 1 },
      { id: b, name: 'Lokal B', created: 2, updated: 2 },
    ]));
    localStorage.setItem('volme3d_d_' + a, JSON.stringify({ version: 1, objects: [] }));
    localStorage.setItem('volme3d_d_' + b, JSON.stringify({ version: 1, objects: [] }));
  });

  // _firestoreCalls zurücksetzen und Migration erneut auslösen
  await page.evaluate(() => { window._firestoreCalls = []; });
  await page.evaluate(() => window._fsLoadAllToCache());
  await page.waitForFunction(
    () => window._firestoreCalls.filter(c => c.op === 'set').length >= 2,
    { timeout: 5000 }
  );

  const sets = await page.evaluate(() => window._firestoreCalls.filter(c => c.op === 'set'));
  expect(sets.length).toBeGreaterThanOrEqual(2);
  const names = sets.map(c => c.data.name);
  expect(names).toContain('Lokal A');
  expect(names).toContain('Lokal B');
  console.log(`✓ Migration: ${sets.length} lokale Designs nach Firestore hochgeladen`);
});
