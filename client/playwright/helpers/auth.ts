import { Page } from '@playwright/test';

/**
 * Log in as the Tecnocim test user.
 * Navigates to /login, fills credentials, and waits for the dashboard redirect.
 */
export async function loginAsTecnocim(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Correo Electronico').fill('alfons.marques@tecnocim.com');
  await page.getByLabel('Contrasena').fill('Tecnocim2026!');
  await page.getByRole('button', { name: 'Iniciar Sesion' }).click();
  // Wait until the app redirects away from /login
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 });
}
