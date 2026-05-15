/**
 * Firestore Security Rules Tests — Volme3D
 *
 * Regeln: users/{uid}/designs/{designId}
 *   → nur lesbar/schreibbar wenn request.auth.uid == uid
 */

const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const fs = require('fs');

const PROJECT_ID = 'volme3d-test';
const RULES_FILE = './firestore.rules';

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(RULES_FILE, 'utf8'),
      host: '127.0.0.1',
      port: 8090,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

// ── Hilfsfunktionen ─────────────────────────────────────────────────────────
const asUser = (uid) =>
  testEnv.authenticatedContext(uid).firestore();

const asAnon = () =>
  testEnv.unauthenticatedContext().firestore();

const designRef = (db, uid, designId = 'design1') =>
  db.collection('users').doc(uid).collection('designs').doc(designId);

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Eingeloggter User — eigene Designs', () => {
  test('kann eigenes Design schreiben', async () => {
    const db = asUser('alice');
    await assertSucceeds(
      designRef(db, 'alice').set({ name: 'Test', updated: Date.now() })
    );
  });

  test('kann eigenes Design lesen', async () => {
    // Erst als Admin schreiben, dann als alice lesen
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await designRef(ctx.firestore(), 'alice').set({ name: 'Secret' });
    });
    const db = asUser('alice');
    await assertSucceeds(designRef(db, 'alice').get());
  });

  test('kann eigenes Design aktualisieren', async () => {
    const db = asUser('alice');
    await designRef(db, 'alice').set({ name: 'Original' });
    await assertSucceeds(
      designRef(db, 'alice').update({ name: 'Geändert' })
    );
  });

  test('kann eigenes Design löschen', async () => {
    const db = asUser('alice');
    await designRef(db, 'alice').set({ name: 'Zu löschen' });
    await assertSucceeds(designRef(db, 'alice').delete());
  });

  test('kann alle eigenen Designs auflisten', async () => {
    const db = asUser('alice');
    await designRef(db, 'alice', 'd1').set({ name: 'D1' });
    await designRef(db, 'alice', 'd2').set({ name: 'D2' });
    await assertSucceeds(
      db.collection('users').doc('alice').collection('designs').get()
    );
  });
});

describe('Eingeloggter User — fremde Designs', () => {
  test('kann Designs eines anderen Users NICHT lesen', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await designRef(ctx.firestore(), 'bob').set({ name: 'Bobs Design' });
    });
    const db = asUser('alice');
    await assertFails(designRef(db, 'bob').get());
  });

  test('kann Designs eines anderen Users NICHT schreiben', async () => {
    const db = asUser('alice');
    await assertFails(
      designRef(db, 'bob').set({ name: 'Hack' })
    );
  });

  test('kann Designs eines anderen Users NICHT auflisten', async () => {
    const db = asUser('alice');
    await assertFails(
      db.collection('users').doc('bob').collection('designs').get()
    );
  });

  test('kann Designs eines anderen Users NICHT löschen', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await designRef(ctx.firestore(), 'bob').set({ name: 'Bobs Design' });
    });
    const db = asUser('alice');
    await assertFails(designRef(db, 'bob').delete());
  });
});

describe('Nicht eingeloggter User (anonym)', () => {
  test('kann KEINE Designs lesen', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await designRef(ctx.firestore(), 'alice').set({ name: 'Secret' });
    });
    const db = asAnon();
    await assertFails(designRef(db, 'alice').get());
  });

  test('kann KEINE Designs schreiben', async () => {
    const db = asAnon();
    await assertFails(
      designRef(db, 'alice').set({ name: 'Anon hack' })
    );
  });

  test('kann KEINE Collections auflisten', async () => {
    const db = asAnon();
    await assertFails(
      db.collection('users').doc('alice').collection('designs').get()
    );
  });
});

describe('Pfad-Sicherheit', () => {
  test('kein Zugriff auf /users/{uid} direkt', async () => {
    const db = asUser('alice');
    await assertFails(
      db.collection('users').doc('alice').get()
    );
  });

  test('kein Zugriff auf beliebige Root-Collections', async () => {
    const db = asUser('alice');
    await assertFails(
      db.collection('other').doc('doc').get()
    );
  });

  test('kein Zugriff auf /users/{uid}/other/', async () => {
    const db = asUser('alice');
    await assertFails(
      db.collection('users').doc('alice').collection('other').doc('x').get()
    );
  });
});
