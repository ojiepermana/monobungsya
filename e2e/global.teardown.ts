import { execFileSync } from 'node:child_process';
import { test as teardown } from '@playwright/test';

teardown('remove the e2e fixtures', () => {
  execFileSync('bun', ['e2e/fixtures/cleanup.ts']);
});
