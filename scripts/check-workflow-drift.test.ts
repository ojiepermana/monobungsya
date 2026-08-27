import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  analyzeRepository,
  checkDashboard,
  renderDashboard,
} from './check-workflow-drift';

const fixtureRoots: string[] = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeFixture(root: string, path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function healthyScope(options?: {
  tableStatus?: string;
  headingStatus?: string;
  specLink?: string;
  codePath?: string;
  testChecked?: boolean;
}): string {
  const tableStatus = options?.tableStatus ?? 'done';
  const headingStatus = options?.headingStatus ?? tableStatus;
  const specLink = options?.specLink ?? '../specs/0001-feature/index.md';
  const codePath = options?.codePath ?? 'src';
  const testMark = options?.testChecked === false ? ' ' : 'x';

  return `# Scope: Fixture

**Workflow:** Beta (verify, then test).

## At a glance

| # | Feature | Phase | Status |
| --- | --- | --- | --- |
| 1 | Feature | Foundation | ${tableStatus} |

## Foundations

### 1. Feature · ${headingStatus}

Fixture feature.
**Done when:** The fixture is consistent.

- [x] Design it (spec)
- [x] Build it: /develop feature
- [x] Verify it: /check verify feature
- [${testMark}] Test it: /test feature

Spec [0001](${specLink}) · code in \`${codePath}\`

## Deferred

- Later enhancement · reason: Waiting for a separate decision · from spec 0001
`;
}

function healthySpec(options?: {
  titleId?: string;
  status?: string;
  openBuild?: boolean;
}): string {
  return `# ${options?.titleId ?? '0001'}. Feature

**Status**: ${options?.status ?? 'Accepted'}

## Summary

Fixture spec.

## Build plan

1. [${options?.openBuild ? ' ' : 'x'}] Build the fixture.
`;
}

function makeHealthyRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'workflow-drift-'));
  fixtureRoots.push(root);
  writeFixture(root, 'docs/scope/scope.md', healthyScope());
  writeFixture(root, 'docs/specs/0001-feature/index.md', healthySpec());
  writeFixture(
    root,
    'docs/specs/0001-feature/verify.md',
    '# Verify\n\n- [x] Complete.\n',
  );
  writeFixture(root, 'src/index.ts', 'export const fixture = true;\n');
  return root;
}

describe('workflow progress analysis', () => {
  it('renders a deterministic healthy dashboard and keeps Deferred outside drift', () => {
    const root = makeHealthyRepo();

    const first = renderDashboard(analyzeRepository(root));
    const second = renderDashboard(analyzeRepository(root));

    expect(first).toBe(second);
    expect(first).toContain('| blocking drift | 0 |');
    expect(first).toContain('| deferred | 1 |');
    expect(first).toContain('## Scope without specs\n\nNone.');
    expect(first).toContain(
      '| Later enhancement | [0001](./specs/0001-feature/index.md) | Waiting for a separate decision |',
    );
    expect(analyzeRepository(root).drifts).toEqual([]);
  });

  it('reports an orphan primary spec', () => {
    const root = makeHealthyRepo();
    writeFixture(
      root,
      'docs/specs/0002-orphan/index.md',
      '# 0002. Orphan\n\n**Status**: Proposed\n',
    );

    const report = analyzeRepository(root);

    expect(report.drifts.some((drift) => drift.code === 'D006')).toBe(true);
    expect(report.orphanSpecs.map((spec) => spec.id)).toEqual(['0002']);
  });

  it('reports broken spec and code pointers', () => {
    const root = makeHealthyRepo();
    writeFixture(
      root,
      'docs/scope/scope.md',
      healthyScope({
        specLink: '../specs/9999-missing/index.md',
        codePath: 'missing/source',
      }),
    );

    const codes = analyzeRepository(root).drifts.map((drift) => drift.code);

    expect(codes).toContain('D001');
    expect(codes).toContain('D011');
  });

  it('reports a spec title number that differs from its directory', () => {
    const root = makeHealthyRepo();
    writeFixture(
      root,
      'docs/specs/0001-feature/index.md',
      healthySpec({ titleId: '0099' }),
    );

    expect(
      analyzeRepository(root).drifts.some((drift) => drift.code === 'D003'),
    ).toBe(true);
  });

  it('reports scope table and heading status disagreement', () => {
    const root = makeHealthyRepo();
    writeFixture(
      root,
      'docs/scope/scope.md',
      healthyScope({ tableStatus: 'done', headingStatus: 'in-progress' }),
    );

    expect(
      analyzeRepository(root).drifts.some((drift) => drift.code === 'D005'),
    ).toBe(true);
  });

  it('reports a built Beta feature without a verification plan', () => {
    const root = makeHealthyRepo();
    rmSync(join(root, 'docs/specs/0001-feature/verify.md'));

    expect(
      analyzeRepository(root).drifts.some((drift) => drift.code === 'D010'),
    ).toBe(true);
  });

  it('reports an explicitly stale verification plan', () => {
    const root = makeHealthyRepo();
    writeFixture(
      root,
      'docs/specs/0001-feature/verify.md',
      '# Verify\n\n> **Stale as of 2026-08-24.**\n\n- [x] Old check.\n',
    );

    expect(
      analyzeRepository(root).drifts.some((drift) => drift.code === 'D009'),
    ).toBe(true);
  });

  it('reports a done feature with incomplete Beta evidence', () => {
    const root = makeHealthyRepo();
    writeFixture(
      root,
      'docs/scope/scope.md',
      healthyScope({ testChecked: false }),
    );
    writeFixture(
      root,
      'docs/specs/0001-feature/verify.md',
      '# Verify\n\n- [ ] Manual check remains.\n',
    );

    expect(
      analyzeRepository(root).drifts.some((drift) => drift.code === 'D008'),
    ).toBe(true);
  });

  it('reports a done feature with an open acceptance checklist item', () => {
    const root = makeHealthyRepo();
    writeFixture(
      root,
      'docs/specs/0001-feature/index.md',
      `${healthySpec()}\n**Acceptance criteria**:\n\n- [ ] Manual acceptance remains.\n`,
    );

    const report = analyzeRepository(root);

    expect(report.drifts.some((drift) => drift.code === 'D008')).toBe(true);
  });

  it('maps a child spec pointer to its umbrella status and verification plan', () => {
    const root = makeHealthyRepo();
    writeFixture(
      root,
      'docs/scope/scope.md',
      healthyScope({
        tableStatus: 'in-progress',
        headingStatus: 'in-progress',
        specLink: '../specs/0010-ui/0010-sdk.md',
        testChecked: false,
      }).replace('- [x] Verify it', '- [ ] Verify it'),
    );
    rmSync(join(root, 'docs/specs/0001-feature'), {
      recursive: true,
      force: true,
    });
    writeFixture(
      root,
      'docs/specs/0010-ui/index.md',
      healthySpec({ titleId: '0010', status: 'In Progress' }),
    );
    writeFixture(root, 'docs/specs/0010-ui/0010-sdk.md', '# 0010. SDK child\n');
    writeFixture(
      root,
      'docs/specs/0010-ui/verify.md',
      '# Verify\n\n- [ ] Manual check.\n',
    );

    const report = analyzeRepository(root);

    expect(report.drifts).toEqual([]);
    expect(report.orphanSpecs).toEqual([]);
    expect(renderDashboard(report)).toContain('| In Progress |');
  });

  it('detects whether the committed dashboard is fresh', () => {
    const root = makeHealthyRepo();
    const expected = renderDashboard(analyzeRepository(root));
    writeFixture(root, 'docs/progress.md', expected);

    expect(checkDashboard(root).fresh).toBe(true);

    writeFixture(root, 'docs/progress.md', '# stale dashboard\n');
    expect(checkDashboard(root).fresh).toBe(false);
  });
});
