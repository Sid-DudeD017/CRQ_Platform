import { defineConfig, devices } from '@playwright/test';

/*
  [Refresh tests for every protected page - see the P0 audit fix]
  Run with: npm run test:e2e (after `npm install` and a one-time
  `npx playwright install chromium`).

  Requires BOTH servers already running, or lets this auto-start the
  frontend dev server (`npm run dev`) if nothing is listening on
  http://localhost:3000 yet - reuseExistingServer means it won't fight
  with a dev server you already have open. The backend
  (uvicorn backend.main:app --port 8000) is NOT auto-started here since
  it lives in a separate Python venv one level up - start it yourself
  first (see backend/README or Support page) so the demo login in these
  tests actually succeeds against a live /api/auth/login.
*/
export default defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    fullyParallel: false,
    retries: 0,
    reporter: 'list',
    use: {
        baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    // In CI, a freshly-spawned `next dev` compiles each route on its
    // first request. On a shared/CPU-constrained CI runner that
    // on-demand compile can take longer than an individual test's own
    // assertion timeout, which is what was making the e2e suite fail in
    // GitHub Actions while passing locally (where routes are usually
    // already compiled from prior dev-server use). Building once and
    // serving the compiled output with `next start` removes that
    // variability. Locally we keep `next dev` with reuseExistingServer
    // so iterating on a test doesn't require a full rebuild every time.
    webServer: process.env.PLAYWRIGHT_BASE_URL
        ? undefined
        : {
              command: process.env.CI ? 'npm run build && npm run start' : 'npm run dev',
              url: 'http://localhost:3000',
              reuseExistingServer: !process.env.CI,
              timeout: 180_000,
          },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
