import { defineConfig, devices } from '@playwright/test';

// e2e cross-navigateurs : Chromium (Chrome/Edge/Opera), Firefox (Gecko) et
// WebKit (Safari). Le serveur applicatif est démarré automatiquement.
const PORT = process.env.E2E_PORT || '3210';
const BASE = `http://localhost:${PORT}`;

// Échappatoire de dev : pointer Chromium sur un binaire déjà présent (sandbox où
// le téléchargement Playwright est bloqué). Ignoré en CI (navigateurs téléchargés).
const localChromium = process.env.LOCAL_CHROMIUM;

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm start',
    url: `${BASE}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PORT,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'admin',
      SESSION_SECRET: 'e2e-secret',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(localChromium ? { launchOptions: { executablePath: localChromium } } : {}),
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
