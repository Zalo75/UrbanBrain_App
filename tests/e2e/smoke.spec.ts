import { test, expect } from '@playwright/test';

test('has title and redirects to login if unauthenticated', async ({ page }) => {
  await page.goto('/');

  // The application should redirect to /login due to our Next.js middleware 
  // since we are not authenticated in this clean session.
  await expect(page).toHaveURL(/.*login/);
  
  // Login page should have a Login title
  await expect(page.locator('h3, h1, .text-2xl')).toContainText('Login');
});
