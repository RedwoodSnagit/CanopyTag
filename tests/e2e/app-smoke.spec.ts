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

test('Projects is a first-level route with a direct execution-graph handoff', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /connect to repo/i }).click();
  await page.getByPlaceholder('/path/to/your/repo').fill(process.cwd());
  await page.getByRole('button', { name: 'Connect', exact: true }).click();

  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Project context and accountability control plane' })).toBeVisible();
  await expect(page.getByText('All recorded tasks complete · awaiting next decision.')).toBeVisible();

  await page.getByRole('button', { name: 'View execution graph' }).click();
  await expect(page.getByLabel('Project packet')).toHaveValue(/PRJ-001/);

  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(page.getByPlaceholder('Filter files...')).toBeVisible();
});
