import { test, expect } from '@playwright/test';
import { loginAsTecnocim } from './helpers/auth';

/**
 * Campaign list and detail flows — read-only assertions only.
 */

test.describe('Campaigns page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTecnocim(page);
    await page.goto('/campaigns');
    // Wait for the loading spinner to disappear or content to appear
    await page.waitForSelector(
      '.animate-spin, [class*="grid"], h3, h1',
      { timeout: 15_000 }
    );
    // Give React Query time to resolve
    await page.waitForTimeout(500);
  });

  test('renders page heading and create button', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Campanas' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nueva Campana' })).toBeVisible();
  });

  test('renders search input', async ({ page }) => {
    await expect(page.getByPlaceholder('Buscar campanas...')).toBeVisible();
  });

  test('shows campaign cards or empty state (not error)', async ({ page }) => {
    const errorText = page.getByText('Error al cargar las campanas');
    await expect(errorText).not.toBeVisible();

    const hasCards = await page.locator('.grid > *').first().isVisible().catch(() => false);
    const hasEmpty = await page.getByText('Sin campanas').isVisible().catch(() => false);

    expect(hasCards || hasEmpty).toBe(true);
  });

  test('opens create campaign modal', async ({ page }) => {
    await page.getByRole('button', { name: 'Nueva Campana' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Nueva Campana' })
    ).toBeVisible();
    await expect(page.getByLabel('Nombre de la Campana')).toBeVisible();
    // Close modal
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('campaign card shows Ver detalle link', async ({ page }) => {
    const hasCards = await page.locator('.grid > *').first().isVisible().catch(() => false);
    if (!hasCards) {
      test.skip();
      return;
    }

    await expect(page.getByText('Ver detalle').first()).toBeVisible();
  });

  test('navigates to campaign detail on Ver detalle click', async ({ page }) => {
    const hasCards = await page.locator('.grid > *').first().isVisible().catch(() => false);
    if (!hasCards) {
      test.skip();
      return;
    }

    await page.getByText('Ver detalle').first().click();
    await expect(page).toHaveURL(/\/campaigns\/[a-zA-Z0-9-]+/, { timeout: 10_000 });
  });

  test('filters campaigns by status', async ({ page }) => {
    const errorText = page.getByText('Error al cargar las campanas');
    await expect(errorText).not.toBeVisible();

    // Select "Activo" from the status filter
    const statusSelect = page.locator('select').first();
    await statusSelect.selectOption('active');
    await page.waitForTimeout(500);

    // Should not show an error after filtering
    await expect(errorText).not.toBeVisible();

    // Reset filter
    await statusSelect.selectOption('');
  });
});

test.describe('Campaign detail page', () => {
  test('shows campaign detail tabs after navigating from list', async ({ page }) => {
    await loginAsTecnocim(page);
    await page.goto('/campaigns');
    await page.waitForTimeout(1_500);

    const hasCards = await page.locator('.grid > *').first().isVisible().catch(() => false);
    if (!hasCards) {
      test.skip();
      return;
    }

    await page.getByText('Ver detalle').first().click();
    await expect(page).toHaveURL(/\/campaigns\/[a-zA-Z0-9-]+/, { timeout: 10_000 });

    // Wait for detail page content
    await page.waitForTimeout(1_000);

    // Detail page should have tabs: Prospectos, Generar, Bandeja, Metricas
    await expect(
      page.getByRole('tab', { name: /Prospectos/i }).or(
        page.getByText('Prospectos').first()
      )
    ).toBeVisible({ timeout: 10_000 });
  });
});
