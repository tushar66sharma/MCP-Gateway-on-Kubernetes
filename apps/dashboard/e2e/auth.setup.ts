import { test as setup } from '@playwright/test';
import { signIn, STORAGE_STATE } from './helpers';

// Signs in once as the admin and saves the session cookie for the desktop and mobile projects.
// The login comes from the environment and is never printed; the state file is git-ignored.
setup('sign in as the admin', async ({ page }) => {
  await signIn(page);
  await page.context().storageState({ path: STORAGE_STATE });
});
