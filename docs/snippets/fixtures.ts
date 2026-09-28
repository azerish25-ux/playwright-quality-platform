import { test as base, expect } from '@playwright/test';
import { createForgeTest } from '@azerish25-ux/forgeqa-playwright';

// Keep the native callable test interface and add application-specific fixtures.
export const test = createForgeTest(base).extend<{ answer: number }>({ answer: 42 });
export { expect };
