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

test('restricts user-management to admin only (spec 0007, AC-8)', () => {
  // Deliberately narrower than 'admin', which also lets a manager through.
  expect(canAccessAuthCapability('admin', 'user-management')).toBe(true);
  expect(canAccessAuthCapability('manager', 'user-management')).toBe(false);
  expect(canAccessAuthCapability('bi', 'user-management')).toBe(false);
  expect(canAccessAuthCapability('staff', 'user-management')).toBe(false);
  expect(canAccessAuthCapability('legacy', 'user-management')).toBe(false);
});
