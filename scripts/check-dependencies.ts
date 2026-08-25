const serviceNames = ['auth', 'user', 'logs'];
const sourceFiles = new Bun.Glob('apps/services/**/*.ts');

for await (const file of sourceFiles.scan('.')) {
  const source = await Bun.file(file).text();
  const currentService = file.split('/')[2];

  for (const serviceName of serviceNames) {
    if (
      serviceName !== currentService &&
      source.includes(`@project/${serviceName}`)
    ) {
      throw new Error(
        `${file} imports another service package: @project/${serviceName}`,
      );
    }
  }

  if (source.includes('apps/services/')) {
    throw new Error(`${file} contains a cross service source import`);
  }
}

console.log('No cross service package or source imports found.');

export {};
