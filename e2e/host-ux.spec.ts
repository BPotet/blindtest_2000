import { test, expect, type Page } from '@playwright/test';

// Confort hôte / UX : thème clair-sombre, aide (onboarding) et duplication de
// quiz — validés dans un vrai navigateur (bout en bout pour la duplication).
async function loginHost(page: Page): Promise<void> {
  await page.route(/youtube\.com|googlevideo\.com|ytimg\.com/, (r) => r.abort());
  await page.goto('/');
  await page.fill('#login-username', 'admin');
  await page.fill('#login-password', 'admin');
  await page.click('#login-btn');
  await expect(page.locator('#screen-home')).toHaveClass(/screen--active/);
}

test('bascule le thème clair/sombre et le mémorise', async ({ page }) => {
  await loginHost(page);
  // Défaut sombre.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.click('#theme-toggle');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // Persistance : après rechargement, le thème clair est conservé.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.click('#theme-toggle');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('ouvre et ferme l\'aide (onboarding hôte)', async ({ page }) => {
  await loginHost(page);
  await expect(page.locator('#help-modal')).toBeHidden();
  await page.click('#help-btn');
  await expect(page.locator('#help-modal')).toBeVisible();
  await expect(page.locator('#help-modal')).toContainText('Comment lancer une partie');
  await page.click('#help-close');
  await expect(page.locator('#help-modal')).toBeHidden();
});

test('duplique un quiz de démo en une copie éditable', async ({ page }) => {
  await loginHost(page);
  await page.locator('.quiz-item').first().waitFor({ state: 'visible' });
  // Aucune copie au départ.
  await expect(page.locator('.quiz-item__title', { hasText: '(copie)' })).toHaveCount(0);
  // Duplique le premier quiz.
  await page.locator('.quiz-item button', { hasText: 'Dupliquer' }).first().click();
  // Une copie apparaît, éditable (bouton Éditer présent sur sa ligne).
  const copy = page.locator('.quiz-item', { hasText: '(copie)' });
  await expect(copy).toHaveCount(1);
  await expect(copy.locator('button', { hasText: 'Éditer' })).toBeVisible();
});
