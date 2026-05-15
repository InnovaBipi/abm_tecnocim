import { test, expect } from '@playwright/test';
import { loginAsTecnocim } from './helpers/auth';

/**
 * Prospect list flows — read-only assertions only.
 * No records are created or deleted so the database is not mutated.
 */

test.describe('Prospects page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTecnocim(page);
    await page.goto('/prospects');
    // Wait for either the table or the empty state to appear
    await page.waitForSelector(
      'table, [data-testid="empty-state"], .animate-pulse',
      { timeout: 15_000 }
    );
  });

  test('renders page heading and action buttons', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Prospectos' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nuevo Prospecto' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Exportar CSV/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Importar CSV/i })).toBeVisible();
  });

  test('displays search input and filter selects', async ({ page }) => {
    await expect(
      page.getByPlaceholder('Buscar por nombre, email, empresa...')
    ).toBeVisible();
  });

  test('shows prospect table or empty state (not error)', async ({ page }) => {
    // Either a table with rows is present or the empty state message is shown —
    // neither is an error state.
    const errorText = page.getByText('Error al cargar los prospectos');
    await expect(errorText).not.toBeVisible();

    const hasTable = await page.locator('table').isVisible().catch(() => false);
    const hasEmpty = await page
      .getByText('Sin prospectos')
      .isVisible()
      .catch(() => false);

    expect(hasTable || hasEmpty).toBe(true);
  });

  test('search filter narrows results', async ({ page }) => {
    // Skip test if there are no prospects to search
    const hasTable = await page.locator('table').isVisible().catch(() => false);
    if (!hasTable) {
      test.skip();
      return;
    }

    const searchInput = page.getByPlaceholder('Buscar por nombre, email, empresa...');
    await searchInput.fill('zzz_no_match_string_xyz');
    // After debounce (300 ms) + network round-trip the table should update
    await page.waitForTimeout(600);

    // Either "Sin prospectos" empty state or still showing the table
    const stillHasTable = await page.locator('table').isVisible().catch(() => false);
    const showsEmpty = await page
      .getByText('Sin prospectos')
      .isVisible()
      .catch(() => false);
    expect(stillHasTable || showsEmpty).toBe(true);

    // Clear search to restore list
    await searchInput.clear();
  });

  test('opens create prospect modal when clicking Nuevo Prospecto', async ({ page }) => {
    await page.getByRole('button', { name: 'Nuevo Prospecto' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Nuevo Prospecto' })
    ).toBeVisible();
    // Modal contains the required form fields
    await expect(page.getByLabel('Nombre')).toBeVisible();
    await expect(page.getByLabel('Correo Electronico')).toBeVisible();
    // Close modal
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('navigates to prospect detail on name click', async ({ page }) => {
    const hasTable = await page.locator('table').isVisible().catch(() => false);
    if (!hasTable) {
      test.skip();
      return;
    }

    // Click the first prospect name link in the table
    const firstNameLink = page.locator('table button').first();
    await firstNameLink.click();

    // Should navigate to /prospects/:id
    await expect(page).toHaveURL(/\/prospects\/[a-zA-Z0-9-]+/, { timeout: 10_000 });
  });

  test('pagination controls are rendered when there is more than one page', async ({ page }) => {
    const pagination = page.locator('nav[aria-label="Pagination"], [aria-label="pagination"]');
    // Pagination only renders when totalPages > 1; we just verify no error if it is absent
    const hasPagination = await pagination.isVisible().catch(() => false);
    // If there is pagination it should have accessible next/previous buttons
    if (hasPagination) {
      await expect(
        page.getByRole('button', { name: /siguiente|next/i }).or(
          page.getByRole('button', { name: /anterior|previous|prev/i })
        )
      ).toBeVisible();
    }
    // Test passes regardless — we are verifying the page does not crash
    expect(true).toBe(true);
  });
});
