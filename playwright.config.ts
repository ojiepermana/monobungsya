import { defineConfig, devices } from '@playwright/test';

/**
 * E2E suite for the web client against the real stack. Every backend service
 * plus the Angular dev server is started here (or reused when already up).
 * PostgreSQL must be running with migrations applied; the setup project
 * seeds its own users and log rows and the teardown removes them.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  reporter: [['line']],
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4311',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, teardown: 'cleanup' },
    { name: 'cleanup', testMatch: /global\.teardown\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/admin.json',
      },
      dependencies: ['setup'],
    },
  ],
  webServer: [
    {
      command:
        'ENABLE_INFRASTRUCTURE=true DURABLE_JOBS_ENABLED=true DATABASE_URL=postgres://postgres@127.0.0.1:5432/monobungsia LOG_DATABASE_URL=postgres://postgres@127.0.0.1:5432/monobungsia PORT=3101 bun apps/services/auth/src/main.ts',
      url: 'http://localhost:3101/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command:
        'ENABLE_INFRASTRUCTURE=true DURABLE_JOBS_ENABLED=true DATABASE_URL=postgres://postgres@127.0.0.1:5432/monobungsia LOG_DATABASE_URL=postgres://postgres@127.0.0.1:5432/monobungsia PORT=3102 bun apps/services/user/src/main.ts',
      url: 'http://localhost:3102/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command:
        'ENABLE_INFRASTRUCTURE=true DATABASE_URL=postgres://postgres@127.0.0.1:5432/monobungsia PORT=3103 bun apps/services/logs/src/main.ts',
      url: 'http://localhost:3103/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command:
        'ENABLE_INFRASTRUCTURE=true DURABLE_JOBS_ENABLED=true DATABASE_URL=postgres://postgres@127.0.0.1:5432/monobungsia LOG_DATABASE_URL=postgres://postgres@127.0.0.1:5432/monobungsia ACCESS_SERVICE_PORT=3104 bun apps/services/access/src/main.ts',
      url: 'http://localhost:3104/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command:
        'ENABLE_INFRASTRUCTURE=true JOBS_DATABASE_URL=postgres://postgres@127.0.0.1:5432/monobungsia LOG_DATABASE_URL=postgres://postgres@127.0.0.1:5432/monobungsia JOBS_SERVICE_PORT=3105 bun apps/services/jobs/src/main.ts',
      url: 'http://localhost:3105/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command:
        'ENABLE_INFRASTRUCTURE=true DURABLE_JOBS_ENABLED=true NOTIFICATION_DATABASE_URL=postgres://postgres@127.0.0.1:5432/monobungsia LOG_DATABASE_URL=postgres://postgres@127.0.0.1:5432/monobungsia NOTIFICATION_SERVICE_PORT=3106 bun apps/services/notification/src/main.ts',
      url: 'http://localhost:3106/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'PORT=3000 bun apps/gateway/erp/src/main.ts',
      url: 'http://localhost:3000/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: '../../node_modules/.bin/ng serve --port 4311',
      cwd: './apps/web',
      url: 'http://localhost:4311',
      reuseExistingServer: true,
      timeout: 240_000,
    },
  ],
});
