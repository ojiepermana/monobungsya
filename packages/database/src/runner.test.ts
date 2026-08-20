import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCliArguments } from './cli';
import { parseCsv } from './csv';
import {
  assertChecksumMatches,
  discoverMigrations,
  discoverSeeds,
} from './runner';
import {
  isDatabaseScope,
  parseMigrationName,
  schemaForScope,
  sha256Hex,
} from './tooling';

describe('database tooling primitives', () => {
  test('maps service scopes to their canonical schema names', () => {
    expect(schemaForScope('auth')).toBe('auth');
    expect(schemaForScope('logs')).toBe('logs');
    expect(isDatabaseScope('user')).toBe(true);
    expect(isDatabaseScope('unknown')).toBe(false);
  });

  test('parses safe command flags and rejects destructive reset without confirmation', () => {
    expect(
      parseCliArguments(['migrate', '--service', 'user', '--dry-run']),
    ).toMatchObject({
      command: 'migrate',
      scope: 'user',
      dryRun: true,
    });
    expect(parseCliArguments(['reset', '--confirm', '--seed'])).toMatchObject({
      command: 'reset',
      confirm: true,
      seed: true,
    });
    expect(() => parseCliArguments(['reset'])).toThrow('requires --confirm');
  });

  test('parses and hashes migration names deterministically', () => {
    expect(parseMigrationName('0007_user_foundation')).toEqual({
      number: 7,
      name: '0007_user_foundation',
    });
    expect(sha256Hex('database')).toBe(
      '3549b0028b75d981cdda2e573e9cb49dedc200185876df299f912b79f69dabd8',
    );
  });

  test('rejects edited applied migration and seed files', () => {
    expect(() =>
      assertChecksumMatches(
        '0001_auth_foundation',
        'edited migration',
        sha256Hex('original migration'),
        'migration',
      ),
    ).toThrow('checksum mismatch for migration');
    expect(() =>
      assertChecksumMatches(
        'reference/auth/0001_auth.users.sql',
        'edited seed',
        sha256Hex('original seed'),
        'seed',
      ),
    ).toThrow('checksum mismatch for seed');
  });

  test('parses quoted RFC 4180 CSV fields and empty values', () => {
    expect(
      parseCsv('id,name,note\n1,"Doe, Jane","line one\nline two"\n2,,'),
    ).toEqual([
      { id: '1', name: 'Doe, Jane', note: 'line one\nline two' },
      { id: '2', name: '', note: '' },
    ]);
  });

  test('discovers migrations with global order and down files', () => {
    const directory = mkdtempSync(
      join(process.env.TMPDIR ?? '/tmp', 'database-migrations-'),
    );

    try {
      mkdirSync(join(directory, 'auth'));
      mkdirSync(join(directory, 'user'));
      writeFileSync(
        join(directory, 'auth', '0001_auth_schema.up.sql'),
        'CREATE SCHEMA auth;',
      );
      writeFileSync(
        join(directory, 'auth', '0001_auth_schema.down.sql'),
        'DROP SCHEMA auth;',
      );
      writeFileSync(
        join(directory, 'user', '0002_user_schema.up.sql'),
        'CREATE SCHEMA user;',
      );
      writeFileSync(
        join(directory, 'user', '0002_user_schema.down.sql'),
        'DROP SCHEMA user;',
      );

      expect(
        discoverMigrations(directory).map((migration) => migration.name),
      ).toEqual(['0001_auth_schema', '0002_user_schema']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects an unknown migration scope', () => {
    const directory = mkdtempSync(
      join(process.env.TMPDIR ?? '/tmp', 'database-invalid-scope-'),
    );

    try {
      mkdirSync(join(directory, 'billing'));
      expect(() => discoverMigrations(directory)).toThrow(
        'unknown migration scope directory "billing"',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects a migration without a matching down file', () => {
    const directory = mkdtempSync(
      join(process.env.TMPDIR ?? '/tmp', 'database-missing-down-'),
    );

    try {
      mkdirSync(join(directory, 'auth'));
      writeFileSync(
        join(directory, 'auth', '0001_auth_schema.up.sql'),
        'CREATE SCHEMA auth;',
      );
      expect(() => discoverMigrations(directory)).toThrow(
        'migration "0001_auth_schema" is missing 0001_auth_schema.down.sql',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects duplicate global migration numbers', () => {
    const directory = mkdtempSync(
      join(process.env.TMPDIR ?? '/tmp', 'database-duplicate-number-'),
    );

    try {
      mkdirSync(join(directory, 'auth'));
      mkdirSync(join(directory, 'user'));
      writeFileSync(
        join(directory, 'auth', '0001_auth_schema.up.sql'),
        'CREATE SCHEMA auth;',
      );
      writeFileSync(
        join(directory, 'auth', '0001_auth_schema.down.sql'),
        'DROP SCHEMA auth;',
      );
      writeFileSync(
        join(directory, 'user', '0001_user_schema.up.sql'),
        'CREATE SCHEMA user;',
      );
      writeFileSync(
        join(directory, 'user', '0001_user_schema.down.sql'),
        'DROP SCHEMA user;',
      );
      expect(() => discoverMigrations(directory)).toThrow(
        'duplicate global migration number "1"',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('discovers CSV seed targets under their matching scope schema', () => {
    const directory = mkdtempSync(
      join(process.env.TMPDIR ?? '/tmp', 'database-seeds-'),
    );

    try {
      mkdirSync(join(directory, 'reference', 'user'), { recursive: true });
      writeFileSync(
        join(directory, 'reference', 'user', '0001_user.users.csv'),
        'id,name\n00000000-0000-7000-8000-000000000001,Jane\n',
      );

      expect(discoverSeeds(directory)[0]?.targetSchema).toBe('user');
      expect(discoverSeeds(directory)[0]?.targetTable).toBe('users');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects an unknown seed scope', () => {
    const directory = mkdtempSync(
      join(process.env.TMPDIR ?? '/tmp', 'database-invalid-seed-scope-'),
    );

    try {
      mkdirSync(join(directory, 'reference', 'billing'), { recursive: true });
      expect(() => discoverSeeds(directory)).toThrow(
        'unknown seed scope directory "billing"',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
