export function templateFiles(packageManager) {
    const run = packageManager === 'pnpm' ? 'pnpm' : 'npm run';
    return {
        'forgeqa.config.ts': `import { defineForgeConfig } from '@azerish25-ux/forgeqa-core';\nexport default defineForgeConfig({\n  project: 'replace-me',\n  environments: { local: { baseUrl: process.env.BASE_URL ?? 'http://127.0.0.1:3000' } },\n  browsers: ['chromium'],\n  workers: 1,\n  retries: process.env.CI ? 1 : 0\n});\n`,
        'playwright.config.ts': `import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './tests/e2e', forbidOnly: Boolean(process.env.CI), retries: process.env.CI ? 1 : 0, reporter: [['list'], ['blob']] });\n`,
        '.env.example': 'BASE_URL=http://127.0.0.1:3000\n',
        '.forgeqa/quarantine.json': '[]\n',
        'tests/e2e/smoke.spec.ts': `import { test, expect } from '@playwright/test';\ntest('forgeqa smoke', { tag: '@smoke' }, async ({ page }) => { await page.goto('/'); await expect(page.locator('body')).toBeVisible(); });\n`,
        '.github/workflows/forgeqa.yml': `name: ForgeQA\non: [pull_request, push]\npermissions: { contents: read }\njobs:\n  quality:\n    runs-on: ubuntu-latest\n    timeout-minutes: 30\n    steps:\n      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6\n      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5\n        with: { node-version: 24, cache: '${packageManager}' }\n      - run: ${packageManager === 'pnpm' ? 'corepack enable && pnpm install --frozen-lockfile' : 'npm ci'}\n      - run: ${run} test\n`,
        'FORGEQA.md': '# ForgeQA onboarding\n\n1. Copy `.env.example` to a local ignored environment file.\n2. Start the application.\n3. Run `forgeqa doctor`, then `forgeqa plan`, then `forgeqa run`.\n4. Quarantine never makes a failing test non-blocking.\n'
    };
}
//# sourceMappingURL=templates.js.map