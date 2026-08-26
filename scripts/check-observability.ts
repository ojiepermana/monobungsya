const requiredApps = [
  'apps/gateway/erp/src/app.ts',
  'apps/services/auth/src/app.ts',
  'apps/services/access/src/app.ts',
  'apps/services/jobs/src/app.ts',
  'apps/services/logs/src/app.ts',
  'apps/services/notification/src/app.ts',
  'apps/services/user/src/app.ts',
] as const;

const requiredResourceKinds = new Set([
  'http.server',
  'http.client',
  'db.query',
  'nats.publish',
  'nats.request',
  'nats.consume',
  'job.enqueue',
  'job.execute',
  'scheduler.tick',
  'smtp.send',
  'fs.operation',
  'process.spawn',
  'business.operation',
]);

interface ImpactMap {
  schemaVersion: string;
  scenarios: Array<{
    scenarioId: string;
    scenarioPath: string;
    baselinePath?: string;
    required: boolean;
    paths: string[];
  }>;
}

const failures: string[] = [];
for (const path of requiredApps) {
  const source = await Bun.file(path).text();
  if (!source.includes('createTelemetryPlugin')) {
    failures.push(`${path} does not register the runtime telemetry plugin`);
  }
}

const impactMap = (await Bun.file(
  'benchmarks/impact-map.json',
).json()) as ImpactMap;
if (impactMap.schemaVersion !== '0014.1' || impactMap.scenarios.length === 0) {
  failures.push('benchmarks/impact-map.json has no supported scenario entries');
}
for (const entry of impactMap.scenarios) {
  const scenario = await Bun.file(entry.scenarioPath)
    .json()
    .catch(() => null);
  const baseline = entry.baselinePath
    ? await Bun.file(entry.baselinePath)
        .json()
        .catch(() => null)
    : null;
  if (!scenario || scenario.scenarioId !== entry.scenarioId) {
    failures.push(
      `${entry.scenarioPath} is missing or has the wrong scenario ID`,
    );
  }
  if (
    entry.required &&
    (!baseline || baseline.scenario?.scenarioId !== entry.scenarioId)
  ) {
    failures.push(
      `${entry.baselinePath ?? entry.scenarioPath} is missing or has the wrong scenario ID`,
    );
  }
  if (entry.required && entry.paths.length === 0) {
    failures.push(`${entry.scenarioId} has no source impact paths`);
  }
}

const scenarioFiles = Array.from(
  new Bun.Glob('benchmarks/scenarios/*.json').scanSync({ absolute: true }),
);
const mappedScenarioPaths = new Set(
  impactMap.scenarios.map((entry) => entry.scenarioPath),
);
for (const path of scenarioFiles) {
  const scenario = await Bun.file(path)
    .json()
    .catch(() => null);
  if (
    !scenario ||
    typeof scenario.scenarioId !== 'string' ||
    typeof scenario.scenarioVersion !== 'string' ||
    !['journey', 'microbenchmark', 'throughput'].includes(scenario.kind) ||
    !['required', 'diagnostic'].includes(scenario.overheadPolicy) ||
    scenario.runner !== 'bun' ||
    typeof scenario.fixtureVersion !== 'string' ||
    typeof scenario.warmupIterations !== 'number' ||
    typeof scenario.measuredIterations !== 'number' ||
    scenario.measuredIterations < 1 ||
    typeof scenario.timeoutMs !== 'number' ||
    !Array.isArray(scenario.tags) ||
    !Array.isArray(scenario.requiredResourceKinds) ||
    !Array.isArray(scenario.operations) ||
    (scenario.batchSize !== undefined &&
      (typeof scenario.batchSize !== 'number' || scenario.batchSize < 1)) ||
    !scenario.operations.every(
      (operation: unknown) => typeof operation === 'string',
    )
  ) {
    failures.push(`${path} does not satisfy the benchmark scenario contract`);
  }
  const relativePath = path.startsWith(`${process.cwd()}/`)
    ? path.slice(process.cwd().length + 1)
    : path;
  if (!mappedScenarioPaths.has(relativePath)) {
    failures.push(
      `${relativePath} is not mapped in benchmarks/impact-map.json`,
    );
  }
  for (const resourceKind of scenario?.requiredResourceKinds ?? []) {
    if (!requiredResourceKinds.has(resourceKind)) {
      failures.push(
        `${path} names an unsupported resource kind: ${resourceKind}`,
      );
    }
  }
}

const inventory = (await Bun.file(
  'benchmarks/resource-inventory.json',
).json()) as {
  schemaVersion?: string;
  seams?: Array<{ resourceKind?: string; path?: string }>;
};
if (inventory.schemaVersion !== '0014.1' || !Array.isArray(inventory.seams)) {
  failures.push('benchmarks/resource-inventory.json is invalid');
} else {
  for (const seam of inventory.seams) {
    if (
      !seam.resourceKind ||
      !requiredResourceKinds.has(seam.resourceKind) ||
      !seam.path
    ) {
      failures.push('resource inventory contains an invalid seam entry');
      continue;
    }
    const source = await Bun.file(seam.path)
      .text()
      .catch(() => '');
    if (!source.includes(seam.resourceKind)) {
      failures.push(
        `${seam.path} is listed for ${seam.resourceKind} but does not use the typed resource kind`,
      );
    }
  }
}

const observabilityPackage = 'packages/observability/src';
const forbidden = ['apps', 'packages'].flatMap((root) =>
  Array.from(new Bun.Glob('**/*.ts').scanSync({ cwd: root, absolute: true })),
);
for (const path of forbidden) {
  if (path.includes(`/${observabilityPackage}/`)) continue;
  const source = await Bun.file(path).text();
  if (
    /INSERT\s+INTO\s+["']telemetry["']\.["'](?:spans|metric_buckets)["']/i.test(
      source,
    )
  ) {
    failures.push(
      `${path} writes signal storage outside packages/observability`,
    );
  }
}

const producerPaths = [
  'packages/telemetry/src/index.ts',
  'packages/logger/src/activity-log.ts',
] as const;
for (const path of producerPaths) {
  const source = await Bun.file(path).text();
  if (!source.includes('#project/observability')) {
    failures.push(`${path} does not use the ObservabilitySignalStore seam`);
  }
  if (source.includes('createPostgresObservabilitySignalStore')) {
    failures.push(
      `${path} constructs a storage adapter instead of receiving one`,
    );
  }
}

const telemetryProducer = await Bun.file(producerPaths[0]).text();
if (telemetryProducer.includes('#project/database')) {
  failures.push(
    'packages/telemetry imports a database client instead of the signal seam',
  );
}
const loggerProducer = await Bun.file(producerPaths[1]).text();
if (
  /INSERT\s+INTO\s+["']logs["']\.["'](?:logging|access_logs)["']/i.test(
    loggerProducer,
  )
) {
  failures.push(
    'packages/logger writes Signal tables instead of using the signal seam',
  );
}
const auditMethod = loggerProducer.slice(
  loggerProducer.indexOf('static async writeAudit'),
  loggerProducer.indexOf('private static appendApplicationLog'),
);
if (auditMethod.includes('signalStore')) {
  failures.push('Audit Trail write path depends on ObservabilitySignalStore');
}

const applicationSourceFiles = Array.from(
  new Bun.Glob('apps/**/*.ts').scanSync({ absolute: true }),
).filter((path) => !path.includes('/tests/') && !path.endsWith('.test.ts'));
for (const path of applicationSourceFiles) {
  const source = await Bun.file(path).text();
  if (/(^|\s)fetch\s*\(/.test(source) && !source.includes('withSpan')) {
    failures.push(
      `${path} has an outbound HTTP seam without a typed telemetry span`,
    );
  }
  if (/sendMail\s*\(/.test(source) && !source.includes('smtp.send')) {
    failures.push(`${path} has an SMTP seam without a typed telemetry span`);
  }
}

if (failures.length > 0) {
  console.error('Observability checks failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Observability checks passed for ${requiredApps.length} backend composition roots.`,
);

export {};
