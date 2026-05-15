import { test, expect } from '@playwright/test';

/**
 * Authentication flows
 *
 * Label selectors are derived from the Input component which generates
 * inputId = label.toLowerCase().replace(/\s+/g, '-'), so:
 *   "Correo Electronico" -> id="correo-electronico"
 *   "Contrasena"        -> id="contrasena"
 */

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('renders login form with all required elements', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
    await expect(page.getByLabel('Correo Electronico')).toBeVisible();
    await expect(page.getByLabel('Contrasena')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Iniciar Sesion' })).toBeVisible();
  });

  test('shows validation toast when submitting empty form', async ({ page }) => {
    await page.getByRole('button', { name: 'Iniciar Sesion' }).click();
    await expect(page.getByText('Por favor, completa todos los campos')).toBeVisible();
  });

  test('shows error toast with wrong credentials', async ({ page }) => {
    await page.getByLabel('Correo Electronico').fill('wrong@tecnocim.com');
    await page.getByLabel('Contrasena').fill('wrongpassword');
    await page.getByRole('button', { name: 'Iniciar Sesion' }).click();
    // The API returns a generic auth error; the toast appears within the error div
    await expect(
      page.getByText(/credenciales|incorrecto|invalid|error/i)
    ).toBeVisible({ timeout: 10_000 });
  });

  test('logs in successfully and redirects to dashboard', async ({ page }) => {
    await page.getByLabel('Correo Electronico').fill('alfons.marques@tecnocim.com');
    await page.getByLabel('Contrasena').fill('Tecnocim2026!');
    await page.getByRole('button', { name: 'Iniciar Sesion' }).click();

    // Should leave /login and land on the dashboard
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    // Dashboard heading is visible in the sidebar/nav
    await expect(page.getByRole('link', { name: 'Dashboard' }).first()).toBeVisible();
    // Success toast
    await expect(page.getByText('Inicio de sesion exitoso')).toBeVisible();
  });

  test('password visibility toggle works', async ({ page }) => {
    const passwordInput = page.getByLabel('Contrasena');
    // Initially masked
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // Click the show-password button
    await page.getByRole('button', { name: 'Mostrar contrasena' }).click();
    await expect(passwordInput).toHaveAttribute('type', 'text');

    // Click again to mask
    await page.getByRole('button', { name: 'Ocultar contrasena' }).click();
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });
});
