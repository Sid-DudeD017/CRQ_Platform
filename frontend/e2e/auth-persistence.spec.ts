import { test, expect, Page } from '@playwright/test';

/*
  [P0 fix verification] "Authentication is lost on refresh or deep links"
  Covers exactly the reported regression: after authenticating, a hard
  reload of a protected page's own URL must keep showing that page, not
  fall back to the public landing page / login form while the address bar
  still shows the protected URL. Also covers the companion fix - an
  unauthenticated deep link is now redirected server-side (middleware.ts)
  instead of momentarily rendering protected content, and a login
  triggered from that redirect lands back on the originally-requested
  page (see SharedLayout.tsx's `next` redirect effect).
*/

const PROTECTED_PAGES: { path: string; heading: RegExp }[] = [
    { path: '/overview', heading: /Portfolio Risk Overview/i },
    { path: '/optimize', heading: /Investment Optimizer/i },
    { path: '/ledger', heading: /Ledger/i },
    { path: '/reports', heading: /Report/i },
    { path: '/calibration', heading: /Calibration/i },
    { path: '/docs', heading: /Documentation/i },
];

async function loginAsDemoCiso(page: Page) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Login' }).first().click();
    await page.getByRole('button', { name: 'Demo CISO' }).click();

    // First login in a fresh browser context still has to pick a
    // dashboard once - the choice is per-account (see SharedLayout's
    // dataSourceKey), not something a fresh Playwright context has saved.
    const chooser = page.getByRole('heading', { name: /How do you want to start/i });
    await expect(chooser.or(page.getByRole('heading', { name: /Portfolio Risk Overview/i }))).toBeVisible({
        timeout: 15_000,
    });
    if (await chooser.isVisible()) {
        await page.getByRole('button', { name: /Run a demo analysis/i }).click();
    }
    await expect(page).toHaveURL(/\/overview$/);
}

test.describe('Session persists across a hard refresh of every protected page', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsDemoCiso(page);
    });

    for (const { path, heading } of PROTECTED_PAGES) {
        test(`refreshing ${path} keeps the session and shows the real page`, async ({ page }) => {
            await page.goto(path);
            await expect(page.getByRole('heading', { name: heading })).toBeVisible();

            // The actual regression under test: a hard reload of this
            // exact URL must not drop back to the logged-out landing page.
            await page.reload();
            await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 10_000 });
            await expect(page).toHaveURL(new RegExp(`${path}$`));
            await expect(page.getByRole('button', { name: 'Login' })).toHaveCount(0);
        });
    }
});

test.describe('Unauthenticated deep links are redirected, not rendered', () => {
    for (const { path } of PROTECTED_PAGES) {
        test(`visiting ${path} while logged out redirects to the start screen`, async ({ page, context }) => {
            await context.clearCookies();
            await page.goto(path);
            // middleware.ts should bounce this before the protected page's
            // own content ever renders.
            await expect(page).toHaveURL(/\/\?next=/);
            await expect(page.getByRole('button', { name: 'Login' }).first()).toBeVisible();
        });
    }

    test('logging in from a redirected deep link returns to it', async ({ page, context }) => {
        await context.clearCookies();
        await page.goto('/optimize');
        await expect(page).toHaveURL(/\/\?next=%2Foptimize/);

        await page.getByRole('button', { name: 'Login' }).first().click();
        await page.getByRole('button', { name: 'Demo CISO' }).click();

        const chooser = page.getByRole('heading', { name: /How do you want to start/i });
        const optimizerHeading = page.getByRole('heading', { name: /Investment Optimizer/i });
        await expect(chooser.or(optimizerHeading)).toBeVisible({ timeout: 15_000 });
        if (await chooser.isVisible()) {
            await page.getByRole('button', { name: /Run a demo analysis/i }).click();
        }

        // Whether or not the chooser appeared, the `next` redirect effect
        // should land back on /optimize, not leave the visitor on /overview.
        await expect(page).toHaveURL(/\/optimize$/, { timeout: 15_000 });
        await expect(optimizerHeading).toBeVisible();
    });
});
