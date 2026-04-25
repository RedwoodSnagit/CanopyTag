import { expect, test } from '@playwright/test';

test('welcome screen loads core entry points', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'CanopyTag' })).toBeVisible();
  await expect(page.getByRole('button', { name: /connect to repo/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /try the demo/i })).toBeVisible();
});

test('frontend dev server proxies the backend config API', async ({ request }) => {
  await expect
    .poll(
      async () => {
        const response = await request.get('/api/config');
        return response.ok();
      },
      { timeout: 10_000 },
    )
    .toBe(true);

  const response = await request.get('/api/config');
  const config = await response.json();
  expect(config.repoName).toBeTruthy();
});
