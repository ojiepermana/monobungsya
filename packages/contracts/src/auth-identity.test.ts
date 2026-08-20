import { expect, test } from 'bun:test';
import { canAccessAuthCapability } from './auth-identity';

test('enforces the global role capability policy', () => {
  expect(canAccessAuthCapability('admin', 'admin')).toBe(true);
  expect(canAccessAuthCapability('manager', 'admin')).toBe(true);
  expect(canAccessAuthCapability('bi', 'admin')).toBe(false);
  expect(canAccessAuthCapability('staff', 'operational')).toBe(true);
  expect(canAccessAuthCapability('legacy', 'operational')).toBe(false);
  expect(canAccessAuthCapability('legacy', 'read')).toBe(true);
});
