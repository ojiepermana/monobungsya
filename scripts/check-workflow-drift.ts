import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export type ScopeStatus =
  | 'planned'
  | 'in-progress'
  | 'done'
  | 'existing'
  | 'dropped';

export type StepName = 'design' | 'build' | 'verify' | 'test';

export interface Drift {
  code: string;
  message: string;
  source: string;
  featureId?: string;
}

export interface VerifySummary {
  path: string;
  checked: number;
  open: number;
  stale: boolean;
}

export interface SpecRecord {
  id: string;
  titleId: string | null;
  title: string;
  status: string | null;
  path: string;
  directory: string;
  content: string;
  verify: VerifySummary | null;
  childPaths: string[];
  openBuildTasks: number;
  openAcceptanceCriteria: number;
}

export interface ScopeFeature {
  id: string;
  name: string;
  phase: string;
  status: ScopeStatus;
  headingName: string;
  headingStatus: ScopeStatus | null;
  section: string;
  specPath: string | null;
  codePaths: string[];
  steps: Record<StepName, boolean | null>;
  nextAction: string;
}

export interface DeferredItem {
  item: string;
  source: string;
  reason: string;
}

export interface ProgressReport {
  workflow: string;
  scopePath: string;
  features: ScopeFeature[];
  specs: SpecRecord[];
  deferred: DeferredItem[];
  drifts: Drift[];
  orphanSpecs: SpecRecord[];
}

const VALID_SCOPE_STATUSES = new Set<ScopeStatus>([
  'planned',
  'in-progress',
  'done',
  'existing',
  'dropped',
]);

const VALID_SPEC_STATUSES = new Set([
  'Proposed',
  'In Progress',
  'Accepted',
  'Assumed',
  'Superseded',
]);

const STEP_LABELS: Record<string, StepName> = {
  'Design it': 'design',
  'Build it': 'build',
  'Verify it': 'verify',
  'Test it': 'test',
};

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function repoRelative(root: string, path: string): string {
  return toPosix(relative(root, path));
}

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function countMatches(content: string, pattern: RegExp): number {
  return [...content.matchAll(pattern)].length;
}

function levelTwoSection(content: string, heading: string): string {
  const startMatch = new RegExp(`^## ${heading}\\s*$`, 'm').exec(content);
  if (!startMatch || startMatch.index === undefined) return '';
  const start = startMatch.index + startMatch[0].length;
  const tail = content.slice(start);
  const next = /^##\s+/m.exec(tail);
  return next?.index === undefined ? tail : tail.slice(0, next.index);
}

function parseVerify(root: string, directory: string): VerifySummary | null {
  const absolute = join(root, directory, 'verify.md');
  if (!existsSync(absolute)) return null;

  const content = readText(absolute);
  return {
    path: repoRelative(root, absolute),
    checked: countMatches(content, /^[-*] \[[xX]\]/gm),
    open: countMatches(content, /^[-*] \[ \]/gm),
    stale:
      /^>\s*\*\*Stale as of/im.test(content) ||
      /^\*\*Status\*\*:\s*Stale\s*$/im.test(content),
  };
}

function parseBuildPlanOpenTasks(content: string): number {
  const buildPlan = levelTwoSection(content, 'Build plan');
  if (!buildPlan) return 0;

  return countMatches(
    buildPlan,
    /^(?:[-*]\s+)?\d+\.\s+\[ \]|^[-*]\s+\[ \]\s+\d+\./gm,
  );
}

function parseAcceptanceCriteriaOpenTasks(content: string): number {
  const heading =
    /^(?:##\s+Acceptance criteria|\*\*Acceptance criteria\*\*[^\n]*)$/im.exec(
      content,
    );
  if (!heading || heading.index === undefined) return 0;

  const tail = content.slice(heading.index + heading[0].length);
  const next = /^##\s+/m.exec(tail);
  const section = next?.index === undefined ? tail : tail.slice(0, next.index);
  return countMatches(section, /^(?:[-*]\s+)?(?:\d+\.\s+)?\[ \]\s+/gm);
}

export function parseSpecs(root: string): SpecRecord[] {
  const specsRoot = join(root, 'docs', 'specs');
  if (!existsSync(specsRoot)) return [];

  return readdirSync(specsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const directory = join('docs', 'specs', entry.name);
      const absoluteIndex = join(root, directory, 'index.md');
      if (!existsSync(absoluteIndex)) return [];

      const content = readText(absoluteIndex);
      const heading = content.match(/^#\s+(\d{4})[.·]\s+(.+)$/m);
      const status =
        content.match(/^\*\*Status\*\*:\s*(.+)$/m)?.[1]?.trim() ?? null;
      const childPaths = readdirSync(join(root, directory))
        .filter(
          (name) =>
            name.endsWith('.md') &&
            !['index.md', 'rationale.md', 'verify.md'].includes(name),
        )
        .sort()
        .map((name) => toPosix(join(directory, name)));

      return [
        {
          id: entry.name.slice(0, 4),
          titleId: heading?.[1] ?? null,
          title: heading?.[2]?.trim() ?? entry.name,
          status,
          path: toPosix(join(directory, 'index.md')),
          directory: toPosix(directory),
          content,
          verify: parseVerify(root, directory),
          childPaths,
          openBuildTasks: parseBuildPlanOpenTasks(content),
          openAcceptanceCriteria: parseAcceptanceCriteriaOpenTasks(content),
        },
      ];
    });
}

function parseScopeTable(markdown: string): Array<{
  id: string;
  name: string;
  phase: string;
  status: ScopeStatus;
}> {
  const table = markdown.match(/^## At a glance\s*$([\s\S]*?)(?=^##\s)/m)?.[1];
  if (!table) return [];

  const rows: Array<{
    id: string;
    name: string;
    phase: string;
    status: ScopeStatus;
  }> = [];

  for (const line of table.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 4 || cells[0] === '#' || /^-+$/.test(cells[0] ?? '')) {
      continue;
    }

    const status = cells[3] as ScopeStatus;
    if (!VALID_SCOPE_STATUSES.has(status)) continue;
    rows.push({
      id: cells[0] ?? '',
      name: cells[1] ?? '',
      phase: cells[2] ?? '',
      status,
    });
  }

  return rows;
}

function parseDeferred(markdown: string): DeferredItem[] {
  const section = markdown.match(/^## Deferred\s*$([\s\S]*)$/m)?.[1] ?? '';
  return section
    .split('\n')
    .filter((line) => /^-\s+/.test(line))
    .map((line) => line.replace(/^-\s+/, '').replaceAll('**', '').trim())
    .map((entry) => {
      const source = entry.match(/\s+·\s+from spec (\d{4})$/i)?.[1] ?? 'scope';
      const withoutSource = entry.replace(/\s+·\s+from spec \d{4}$/i, '');
      const [item, reason] = withoutSource.split(' · reason: ', 2);
      return {
        item: item?.trim() ?? withoutSource,
        source,
        reason: reason?.trim() ?? 'Reason not recorded in scope.',
      };
    });
}

function parseSteps(section: string): Record<StepName, boolean | null> {
  const steps: Record<StepName, boolean | null> = {
    design: null,
    build: null,
    verify: null,
    test: null,
  };

  for (const match of section.matchAll(
    /^- \[([ xX])\]\s+(Design it|Build it|Verify it|Test it)\b/gm,
  )) {
    const name = STEP_LABELS[match[2] ?? ''];
    if (name) steps[name] = (match[1] ?? '').toLowerCase() === 'x';
  }

  return steps;
}

function nextAction(
  status: ScopeStatus,
  steps: Record<StepName, boolean | null>,
): string {
  if (status === 'existing' || status === 'done') return 'Complete';
  if (status === 'dropped') return 'Dropped';
  for (const name of ['design', 'build', 'verify', 'test'] as StepName[]) {
    if (steps[name] === false) return name;
  }
  return 'Reconcile status';
}

export function parseScope(
  root: string,
  scopePath = 'docs/scope/scope.md',
): {
  workflow: string;
  features: ScopeFeature[];
  deferred: DeferredItem[];
} {
  const absoluteScope = join(root, scopePath);
  const markdown = readText(absoluteScope);
  const rows = parseScopeTable(markdown);
  const headings = [
    ...markdown.matchAll(
      /^###\s+([A-Za-z0-9]+)\.\s+(.+?)(?:\s+·\s+(planned|in-progress|done|existing|dropped))?\s*$/gm,
    ),
  ];
  const boundaries = [...markdown.matchAll(/^#{2,3}\s+/gm)]
    .map((match) => match.index ?? 0)
    .sort((left, right) => left - right);
  const sectionById = new Map(
    headings.map((match) => {
      const start = (match.index ?? 0) + match[0].length;
      const end = boundaries.find((index) => index > start) ?? markdown.length;
      return [
        match[1] ?? '',
        {
          name: match[2]?.trim() ?? '',
          status: (match[3] as ScopeStatus | undefined) ?? null,
          content: markdown.slice(start, end),
        },
      ] as const;
    }),
  );

  const features = rows.map((row): ScopeFeature => {
    const match = sectionById.get(row.id);
    const section = match?.content ?? '';
    const pointerLine = section
      .split('\n')
      .find((line) => line.trimStart().startsWith('Spec '));
    const specLink = pointerLine?.match(/^Spec\s+\[[^\]]+\]\(([^)]+)\)/)?.[1];
    const specPath = specLink
      ? repoRelative(root, resolve(dirname(absoluteScope), specLink))
      : null;
    const codeSegment = pointerLine
      ?.split('· code in ')[1]
      ?.split(' · planned')[0];
    const codePaths = codeSegment
      ? [...codeSegment.matchAll(/`([^`]+)`/g)].map((pathMatch) =>
          repoRelative(root, resolve(root, pathMatch[1] ?? '')),
        )
      : [];
    const steps = parseSteps(section);

    return {
      ...row,
      headingName: match?.name ?? '',
      headingStatus: match?.status ?? null,
      section,
      specPath,
      codePaths,
      steps,
      nextAction: nextAction(row.status, steps),
    };
  });

  return {
    workflow:
      markdown.match(/^\*\*Workflow:\*\*\s+(.+)$/m)?.[1]?.trim() ?? 'Unknown',
    features,
    deferred: parseDeferred(markdown),
  };
}

function expectedSpecStatus(status: ScopeStatus): string | null {
  if (status === 'planned') return 'Proposed';
  if (status === 'in-progress') return 'In Progress';
  if (status === 'done' || status === 'existing') return 'Accepted';
  return null;
}

function addDrift(drifts: Drift[], drift: Drift): void {
  if (
    !drifts.some(
      (item) =>
        item.code === drift.code &&
        item.source === drift.source &&
        item.featureId === drift.featureId,
    )
  ) {
    drifts.push(drift);
  }
}

export function analyzeRepository(root: string): ProgressReport {
  const scopePath = 'docs/scope/scope.md';
  const scope = parseScope(root, scopePath);
  const specs = parseSpecs(root);
  const specsByPath = new Map(specs.map((spec) => [spec.path, spec]));
  const childToParent = new Map<string, SpecRecord>();
  for (const spec of specs) {
    for (const child of spec.childPaths) childToParent.set(child, spec);
  }

  const drifts: Drift[] = [];
  const referencedSpecs = new Set<string>();

  for (const spec of specs) {
    if (spec.titleId !== spec.id) {
      addDrift(drifts, {
        code: 'D003',
        message: `Spec directory ${spec.id} has title number ${spec.titleId ?? 'missing'}.`,
        source: spec.path,
      });
    }
    if (!spec.status || !VALID_SPEC_STATUSES.has(spec.status)) {
      addDrift(drifts, {
        code: 'D004',
        message: `Spec ${spec.id} has a missing or invalid status.`,
        source: spec.path,
      });
    }
    if (spec.verify?.stale) {
      addDrift(drifts, {
        code: 'D009',
        message: `Spec ${spec.id} verification plan is explicitly stale.`,
        source: spec.verify.path,
      });
    }
  }

  for (const feature of scope.features) {
    if (
      feature.headingName !== feature.name ||
      feature.headingStatus !== feature.status
    ) {
      addDrift(drifts, {
        code: 'D005',
        message: `Scope table and section disagree for feature ${feature.id}.`,
        source: scopePath,
        featureId: feature.id,
      });
    }

    let governingSpec: SpecRecord | undefined;
    if (!feature.specPath) {
      addDrift(drifts, {
        code: 'D002',
        message: `Feature ${feature.id} has no spec pointer.`,
        source: scopePath,
        featureId: feature.id,
      });
    } else if (!existsSync(join(root, feature.specPath))) {
      addDrift(drifts, {
        code: 'D001',
        message: `Feature ${feature.id} points to missing spec ${feature.specPath}.`,
        source: scopePath,
        featureId: feature.id,
      });
    } else {
      governingSpec =
        specsByPath.get(feature.specPath) ??
        childToParent.get(feature.specPath);
      if (governingSpec) referencedSpecs.add(governingSpec.path);
    }

    for (const codePath of feature.codePaths) {
      if (!existsSync(join(root, codePath))) {
        addDrift(drifts, {
          code: 'D011',
          message: `Feature ${feature.id} points to missing code path ${codePath}.`,
          source: scopePath,
          featureId: feature.id,
        });
      }
    }

    if (!['existing', 'dropped'].includes(feature.status)) {
      if (feature.steps.verify === null || feature.steps.test === null) {
        addDrift(drifts, {
          code: 'D007',
          message: `Beta feature ${feature.id} must have Verify it and Test it steps.`,
          source: scopePath,
          featureId: feature.id,
        });
      }
      if (feature.steps.build === true && !governingSpec?.verify) {
        addDrift(drifts, {
          code: 'D010',
          message: `Built Beta feature ${feature.id} has no verify.md plan.`,
          source: governingSpec?.path ?? scopePath,
          featureId: feature.id,
        });
      }
    }

    if (feature.status === 'done') {
      const incompleteSteps = (
        Object.entries(feature.steps) as Array<[StepName, boolean | null]>
      )
        .filter(([, state]) => state !== true)
        .map(([name]) => name);
      if (
        incompleteSteps.length > 0 ||
        (governingSpec?.verify?.open ?? 0) > 0 ||
        (governingSpec?.openAcceptanceCriteria ?? 0) > 0
      ) {
        const openAcceptance = governingSpec?.openAcceptanceCriteria ?? 0;
        addDrift(drifts, {
          code: 'D008',
          message: `Done feature ${feature.id} still has open Beta evidence: ${incompleteSteps.join(', ') || (openAcceptance > 0 ? `${openAcceptance} acceptance criteria` : 'verify checklist')}.`,
          source: scopePath,
          featureId: feature.id,
        });
      }
    }

    if (
      feature.steps.build === true &&
      governingSpec &&
      governingSpec.openBuildTasks > 0
    ) {
      addDrift(drifts, {
        code: 'D013',
        message: `Feature ${feature.id} marks Build it complete while spec ${governingSpec.id} has ${governingSpec.openBuildTasks} open build tasks.`,
        source: governingSpec.path,
        featureId: feature.id,
      });
    }

    const expected = expectedSpecStatus(feature.status);
    if (
      expected &&
      governingSpec?.status &&
      governingSpec.status !== expected &&
      governingSpec.status !== 'Assumed' &&
      !(
        governingSpec.status === 'Superseded' &&
        (feature.status === 'done' || feature.status === 'existing')
      )
    ) {
      addDrift(drifts, {
        code: 'D012',
        message: `Feature ${feature.id} is ${feature.status}, but spec ${governingSpec.id} is ${governingSpec.status}.`,
        source: governingSpec.path,
        featureId: feature.id,
      });
    }
  }

  const orphanSpecs = specs.filter((spec) => !referencedSpecs.has(spec.path));
  for (const spec of orphanSpecs) {
    addDrift(drifts, {
      code: 'D006',
      message: `Spec ${spec.id} is not referenced by any scope feature.`,
      source: spec.path,
    });
  }

  drifts.sort((left, right) =>
    `${left.code}:${left.source}:${left.featureId ?? ''}`.localeCompare(
      `${right.code}:${right.source}:${right.featureId ?? ''}`,
    ),
  );

  return {
    workflow: scope.workflow,
    scopePath,
    features: scope.features,
    specs,
    deferred: scope.deferred,
    drifts,
    orphanSpecs,
  };
}

function markdownEscape(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function dashboardLink(path: string): string {
  return path.startsWith('docs/')
    ? `./${path.slice('docs/'.length)}`
    : `../${path}`;
}

function stage(state: boolean | null): string {
  if (state === true) return '✓';
  if (state === false) return 'open';
  return 'none';
}

function featureSpec(
  report: ProgressReport,
  feature: ScopeFeature,
): SpecRecord | undefined {
  return report.specs.find(
    (spec) =>
      spec.path === feature.specPath ||
      spec.childPaths.includes(feature.specPath ?? ''),
  );
}

export function renderDashboard(report: ProgressReport): string {
  const counts = new Map<ScopeStatus, number>([
    ['planned', 0],
    ['in-progress', 0],
    ['done', 0],
    ['existing', 0],
    ['dropped', 0],
  ]);
  for (const feature of report.features) {
    counts.set(feature.status, (counts.get(feature.status) ?? 0) + 1);
  }

  const lines = [
    '# Progress: Monobungsia',
    '',
    '_Generated by `bun run progress:generate`. Edit scope, specs, verify plans, or code pointers, then regenerate this file._',
    '',
    `**Workflow:** ${report.workflow}`,
    '',
    '## Summary',
    '',
    '| Metric | Count |',
    '| --- | ---: |',
    `| planned | ${counts.get('planned')} |`,
    `| in-progress | ${counts.get('in-progress')} |`,
    `| done | ${counts.get('done')} |`,
    `| existing | ${counts.get('existing')} |`,
    `| dropped | ${counts.get('dropped')} |`,
    `| blocking drift | ${report.drifts.length} |`,
    `| deferred | ${report.deferred.length} |`,
    '',
    '## Feature progress',
    '',
    '| # | Feature | Phase | Scope | Spec | Spec status | Build | Verify | Test | Code evidence | Drift | Next |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const feature of report.features) {
    const spec = featureSpec(report, feature);
    const specLabel = feature.specPath
      ? `[${spec?.id ?? 'missing'}](${dashboardLink(feature.specPath)})`
      : 'missing';
    const featureDrifts = report.drifts
      .filter((drift) => drift.featureId === feature.id)
      .map((drift) => drift.code)
      .join(', ');
    const missingCode = report.drifts.filter(
      (drift) => drift.code === 'D011' && drift.featureId === feature.id,
    ).length;
    const existingCode = feature.codePaths.length - missingCode;
    const evidence =
      feature.codePaths.length === 0
        ? 'none'
        : `${existingCode}/${feature.codePaths.length}`;
    lines.push(
      `| ${feature.id} | ${markdownEscape(feature.name)} | ${feature.phase} | ${feature.status} | ${specLabel} | ${spec?.status ?? 'missing'} | ${stage(feature.steps.build)} | ${stage(feature.steps.verify)} | ${stage(feature.steps.test)} | ${evidence} | ${featureDrifts || 'none'} | ${feature.nextAction} |`,
    );
  }

  lines.push('', '## Blocking drift', '');
  if (report.drifts.length === 0) {
    lines.push('No blocking drift.');
  } else {
    for (const drift of report.drifts) {
      lines.push(
        `1. **${drift.code}** ${markdownEscape(drift.message)} ([source](${dashboardLink(drift.source)}))`,
      );
    }
  }

  lines.push('', '## Closeout debt', '');
  const debt = report.features.filter(
    (feature) =>
      feature.status === 'planned' || feature.status === 'in-progress',
  );
  if (debt.length === 0) {
    lines.push('No active closeout debt.');
  } else {
    for (const feature of debt) {
      const spec = featureSpec(report, feature);
      const verify = spec?.verify;
      const verifyDebt = verify
        ? `${verify.open} verify steps open`
        : 'verify plan missing';
      lines.push(
        `1. **${feature.id}. ${markdownEscape(feature.name)}:** next ${feature.nextAction}, ${verifyDebt}.`,
      );
    }
  }

  lines.push('', '## Specs without scope', '');
  if (report.orphanSpecs.length === 0) {
    lines.push('None.');
  } else {
    for (const spec of report.orphanSpecs) {
      lines.push(
        `1. [${spec.id}. ${markdownEscape(spec.title)}](${dashboardLink(spec.path)})`,
      );
    }
  }

  lines.push('', '## Scope without specs', '');
  const scopeWithoutSpecs = report.features.filter(
    (feature) => !featureSpec(report, feature),
  );
  if (scopeWithoutSpecs.length === 0) {
    lines.push('None.');
  } else {
    for (const feature of scopeWithoutSpecs) {
      lines.push(
        `1. **${feature.id}. ${markdownEscape(feature.name)}** (${feature.specPath ? `broken pointer: \`${feature.specPath}\`` : 'spec pointer missing'})`,
      );
    }
  }

  lines.push('', '## Deferred', '');
  if (report.deferred.length === 0) {
    lines.push('None.');
  } else {
    lines.push('| Item | Source spec | Reason |', '| --- | --- | --- |');
    for (const item of report.deferred) {
      const sourceSpec = report.specs.find((spec) => spec.id === item.source);
      const source = sourceSpec
        ? `[${item.source}](${dashboardLink(sourceSpec.path)})`
        : item.source;
      lines.push(
        `| ${markdownEscape(item.item)} | ${source} | ${markdownEscape(item.reason)} |`,
      );
    }
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function checkDashboard(root: string): {
  report: ProgressReport;
  expected: string;
  current: string | null;
  fresh: boolean;
} {
  const report = analyzeRepository(root);
  const expected = renderDashboard(report);
  const dashboardPath = join(root, 'docs', 'progress.md');
  const current = existsSync(dashboardPath) ? readText(dashboardPath) : null;
  return { report, expected, current, fresh: current === expected };
}

function checkSummary(report: ProgressReport, fresh: boolean): string {
  const status = report.drifts.length === 0 && fresh ? 'PASS' : 'FAIL';
  return [
    `## Workflow drift ${status}`,
    '',
    `Blocking drift: ${report.drifts.length}`,
    `Dashboard fresh: ${fresh ? 'yes' : 'no'}`,
    `Features: ${report.features.length}`,
    `Deferred: ${report.deferred.length}`,
    '',
    ...report.drifts.map(
      (drift) => `- ${drift.code}: ${drift.message} (${drift.source})`,
    ),
    !fresh ? '- D014: docs/progress.md is missing or stale.' : '',
    '',
  ]
    .filter((line, index, all) => line !== '' || all[index - 1] !== '')
    .join('\n');
}

if (import.meta.main) {
  const root = process.cwd();
  const command = process.argv[2] ?? 'check';

  if (command === 'generate') {
    const report = analyzeRepository(root);
    const output = renderDashboard(report);
    writeFileSync(join(root, 'docs', 'progress.md'), output);
    console.log(
      `Generated docs/progress.md with ${report.features.length} features and ${report.drifts.length} blocking drift items.`,
    );
  } else if (command === 'check') {
    const result = checkDashboard(root);
    const summary = checkSummary(result.report, result.fresh);
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    }
    if (result.report.drifts.length > 0 || !result.fresh) {
      process.exitCode = 1;
    }
  } else {
    console.error(`Unknown command: ${command}. Use generate or check.`);
    process.exitCode = 2;
  }
}
