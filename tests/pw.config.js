const { defineConfig } = require('/home/v3da/node_modules/@playwright/test');
module.exports = defineConfig({
  testDir: '/home/v3da/tests',
  timeout: 60000,
  use: {
    headless: false,
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      slowMo: 0,
      env: { DISPLAY: ':0' },
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
  reporter: 'line',
});
