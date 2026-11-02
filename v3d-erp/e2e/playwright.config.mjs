// End-to-End-Tests (replica-test). Start: cd ~/v3d-erp && ~/node_modules/.bin/playwright test -c e2e
// Startet einen eigenen Testserver auf 8897 mit frischen Testdaten (/tmp/erp-e2e) – berührt nie die Prototyp-DB.
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs/,
  workers: 1,                         // eine SQLite-Datenbank, Specs bauen teils aufeinander auf
  fullyParallel: false,
  timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: '/tmp/erp-e2e-ergebnis.json' }]],
  use: { baseURL: 'http://127.0.0.1:8897/', viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  outputDir: '/tmp/erp-e2e-artefakte',
  webServer: {
    command: 'rm -rf /tmp/erp-e2e && V3D_ERP_DATEN=/tmp/erp-e2e .venv/bin/python server.py 8897',
    cwd: '..', url: 'http://127.0.0.1:8897/', reuseExistingServer: false, timeout: 30_000,
  },
});
