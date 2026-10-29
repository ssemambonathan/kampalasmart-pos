import { expect, test, type Page } from '@playwright/test';

const OWNER = { email: 'owner@mirembe.test', password: 'OwnerPass123!' };
const CASHIER = { email: 'cashier@mirembe.test', password: 'CashierPass123!' };

async function signIn(page: Page, credentials: { email: string; password: string }) {
  await page.goto('/login');
  await page.locator('#email').fill(credentials.email);
  await page.locator('#password').fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

test.describe('KampalaSmart smoke', () => {
  test('landing page labels the POS mockup as an illustrative preview', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Run the whole shop/i })).toBeVisible();
    await expect(page.getByText('Illustrative product preview — not live business data.')).toBeVisible();
  });

  test('owner signs in and the POS adds a catalogue item to the cart', async ({ page }) => {
    await signIn(page, OWNER);
    await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible({
      timeout: 20_000,
    });

    await page.goto('/pos');
    const addCoke = page.getByRole('button', { name: /^Add Coca-Cola 500ml/ });
    await expect(addCoke).toBeVisible({ timeout: 30_000 });
    await addCoke.click();
    await expect(page.getByLabel('Quantity for Coca-Cola 500ml')).toBeVisible();
  });

  test('cashier is blocked from settings without console errors', async ({ page }) => {
    await signIn(page, CASHIER);

    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto('/settings');
    await expect(page.getByText('Settings are managed by the owner')).toBeVisible({ timeout: 30_000 });

    await page.goto('/pos');
    const addCoke = page.getByRole('button', { name: /^Add Coca-Cola 500ml/ });
    await expect(addCoke).toBeVisible({ timeout: 30_000 });
    await addCoke.click();
    await expect(page.getByLabel('Quantity for Coca-Cola 500ml')).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });
});
