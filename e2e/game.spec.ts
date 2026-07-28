import { test, expect, type Page } from '@playwright/test';

// e2e « fumée » exécuté sur Chromium, Firefox et WebKit (voir playwright.config).
// On bloque YouTube pour rendre le test déterministe et indépendant d'un service
// externe : sans lecteur, le jeu bascule sur son repli et ouvre la manche tout de
// suite. On valide ainsi toute la stack (HTTP + Socket.IO + DOM) dans chaque moteur.
async function blockYouTube(page: Page): Promise<void> {
  await page.route(/youtube\.com|googlevideo\.com|ytimg\.com/, (r) => r.abort());
}

test('l\'appli se lance et joue une manche complète', async ({ page, context }) => {
  await blockYouTube(page);

  // --- Connexion hôte ---
  await page.goto('/');
  await page.fill('#login-username', 'admin');
  await page.fill('#login-password', 'admin');
  await page.click('#login-btn');
  await expect(page.locator('#screen-home')).toHaveClass(/screen--active/);

  // --- Ouverture d'une salle via la modale de configuration ---
  await page.locator('.quiz-item button').first().click();
  await expect(page.locator('#room-config-modal')).toBeVisible();
  await page.click('#room-config-confirm');
  await expect(page.locator('#screen-lobby')).toHaveClass(/screen--active/);
  const code = (await page.locator('#lobby-code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-Z0-9]{4,}$/);

  // --- Un joueur rejoint (autre onglet) ---
  const player = await context.newPage();
  await blockYouTube(player);
  await player.goto(`/join?code=${code}`);
  await player.fill('#join-pseudo', 'Alice');
  await player.click('#join-btn');
  await expect(player.locator('#screen-wait')).toHaveClass(/screen--active/);
  await expect(page.locator('#player-count')).toHaveText('1');

  // --- L'hôte démarre, le joueur voit les propositions et répond ---
  await page.click('#start-game');
  await player.locator('#q-options .option').first().waitFor({ state: 'visible', timeout: 20_000 });
  await player.locator('#q-options .option').first().click();

  // --- L'hôte révèle (après le décompte 3·2·1) : résultat des deux côtés ---
  await page.waitForFunction(() => !document.querySelector('.countdown-overlay'), null, { timeout: 15_000 });
  await page.click('#reveal-answer');
  await expect(page.locator('#screen-result')).toHaveClass(/screen--active/);
  await expect(page.locator('#result-leaderboard')).toContainText('Alice');
  await expect(player.locator('#screen-feedback')).toHaveClass(/screen--active/);
});
