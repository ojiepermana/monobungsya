/**
 * Frees the ports `bun run dev` needs before the dev servers start.
 *
 * The port list is derived from package.json: every `dev:*` script the `dev`
 * script runs is scanned for a `PORT=<n>` or `--port <n>` value, so adding a
 * new service to `dev` needs no change here. Ports can also be passed as
 * arguments (`bun run scripts/kill-dev-ports.ts 3000 4200`), and `--dry-run`
 * reports what would be stopped without stopping anything.
 */

type PackageJson = { scripts?: Record<string, string> };

const PORT_PATTERN = /(?:\bPORT=|--port[= ])(\d{2,5})/g;
const SCRIPT_PATTERN = /\bdev:[a-z0-9:-]+/g;
const SHUTDOWN_TIMEOUT_MS = 3000;
const POLL_INTERVAL_MS = 100;

const dryRun = process.argv.includes('--dry-run');

function portsFromArguments(): number[] {
  const values = process.argv
    .slice(2)
    .filter((value) => !value.startsWith('--'))
    .map((value) => Number(value));

  for (const value of values) {
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new Error(`Not a valid port: ${value}`);
    }
  }

  return values;
}

async function portsFromPackageJson(): Promise<number[]> {
  const packageJson = (await Bun.file(
    `${import.meta.dir}/../package.json`,
  ).json()) as PackageJson;
  const scripts = packageJson.scripts ?? {};
  const devScript = scripts.dev;

  if (!devScript) {
    throw new Error('package.json has no dev script to read ports from');
  }

  const ports = new Set<number>();
  const visited = new Set<string>();
  const queue: string[] = devScript.match(SCRIPT_PATTERN) ?? [];

  while (queue.length > 0) {
    const name = queue.shift() as string;

    if (visited.has(name)) {
      continue;
    }
    visited.add(name);

    const command = scripts[name];
    if (!command) {
      continue;
    }

    for (const match of command.matchAll(PORT_PATTERN)) {
      ports.add(Number(match[1]));
    }
    queue.push(...(command.match(SCRIPT_PATTERN) ?? []));
  }

  return [...ports].sort((left, right) => left - right);
}

function listeningPids(port: number): number[] {
  const command =
    process.platform === 'win32'
      ? ['netstat', '-ano', '-p', 'tcp']
      : ['lsof', '-ti', `tcp:${port}`, '-sTCP:LISTEN'];

  let output: string;
  try {
    // lsof exits 1 when nothing listens on the port, which is not an error.
    output = Bun.spawnSync(command, { stderr: 'ignore' }).stdout.toString();
  } catch {
    console.warn(
      `Could not inspect port ${port}: ${command[0]} is not available.`,
    );
    return [];
  }

  const pids =
    process.platform === 'win32'
      ? output
          .split('\n')
          .filter(
            (line) => line.includes('LISTENING') && line.includes(`:${port} `),
          )
          .map((line) => Number(line.trim().split(/\s+/).at(-1)))
      : output
          .split('\n')
          .map((line) => Number(line.trim()))
          .filter((pid) => Number.isInteger(pid) && pid > 0);

  return [...new Set(pids)].filter(
    (pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid,
  );
}

function processName(pid: number): string {
  if (process.platform === 'win32') {
    return 'pid';
  }

  try {
    const output = Bun.spawnSync(['ps', '-p', String(pid), '-o', 'comm='], {
      stderr: 'ignore',
    }).stdout.toString();
    const [command] = output.trim().split(/\s+/);
    return command?.split('/').at(-1) || 'unknown';
  } catch {
    return 'unknown';
  }
}

function signal(pid: number, name: NodeJS.Signals): boolean {
  try {
    process.kill(pid, name);
    return true;
  } catch {
    // The process is already gone, or is not ours to signal.
    return false;
  }
}

async function freePort(port: number): Promise<void> {
  const pids = listeningPids(port);

  if (pids.length === 0) {
    console.log(`Port ${port} is free.`);
    return;
  }

  // Names are read before signalling, a stopped process has none to read.
  const names = new Map(pids.map((pid) => [pid, processName(pid)]));

  if (dryRun) {
    const held = pids.map((pid) => `${names.get(pid)} (${pid})`).join(', ');
    console.log(`Port ${port} is held by ${held}, would stop it.`);
    return;
  }

  for (const pid of pids) {
    if (signal(pid, 'SIGTERM')) {
      console.log(`Port ${port}: asked ${names.get(pid)} (${pid}) to stop.`);
    }
  }

  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
  while (Date.now() < deadline && listeningPids(port).length > 0) {
    await Bun.sleep(POLL_INTERVAL_MS);
  }

  for (const pid of listeningPids(port)) {
    const name = names.get(pid) ?? processName(pid);
    if (signal(pid, 'SIGKILL')) {
      console.log(`Port ${port}: forced ${name} (${pid}) to stop.`);
    }
  }

  const remaining = listeningPids(port);
  if (remaining.length > 0) {
    console.warn(
      `Port ${port} is still held by ${remaining.join(', ')}. The dev server for this port will fail to start.`,
    );
    return;
  }

  console.log(`Port ${port} is free.`);
}

const requested = portsFromArguments();
const ports = requested.length > 0 ? requested : await portsFromPackageJson();

if (ports.length === 0) {
  console.warn('No dev ports found in package.json, nothing to free.');
} else {
  console.log(`Dev ports: ${ports.join(', ')}`);
  for (const port of ports) {
    await freePort(port);
  }
}

export {};
