import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '..');

function readRepositoryFile(path: string): string {
  return readFileSync(join(repositoryRoot, path), 'utf8');
}

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(join(repositoryRoot, directory), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(path);
    return entry.isFile() && path.endsWith('.ts') && !path.endsWith('.test.ts')
      ? [path]
      : [];
  });
}

describe('Angular UI package and CSS standard', () => {
  it('keeps the package theme, Tailwind, token map, and library icon provider', () => {
    const styles = readRepositoryFile('apps/web/src/styles.css');
    const appConfig = readRepositoryFile(
      'apps/web/src/app/shell/app.config.ts',
    );

    expect(styles).toContain(
      '@import "@ojiepermana/angular-theme/theme-full.css";',
    );
    expect(styles).toContain('@import "tailwindcss" source(none);');
    expect(styles).toContain(
      '@import "@ojiepermana/angular-theme/styles/css/base/tailwind.css";',
    );
    expect(appConfig).toContain(
      "import { provideMaterialSymbols } from '@ojiepermana/angular/component/icon';",
    );
    expect(appConfig).toContain(
      "provideMaterialSymbols({ href: '/assets/icons/material-symbols.css' }),",
    );
    expect(styles).not.toMatch(/fontsource.*material-symbols/);
    expect(styles).not.toMatch(/https?:\/\//);
    expect(styles).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  });

  it('keeps Angular component generation and active web styles on CSS', () => {
    const angularConfig = JSON.parse(
      readRepositoryFile('apps/web/angular.json'),
    ) as {
      projects: {
        app: {
          schematics: { '@schematics/angular:component': { style: string } };
          architect: {
            build: {
              options: { inlineStyleLanguage: string; styles: string[] };
            };
          };
        };
      };
    };
    const config = angularConfig.projects.app;

    expect(config.schematics['@schematics/angular:component'].style).toBe(
      'css',
    );
    expect(config.architect.build.options.inlineStyleLanguage).toBe('css');
    expect(config.architect.build.options.styles).toContain('src/styles.css');

    const source = productionTypeScriptFiles('apps/web/src')
      .map((path) => readRepositoryFile(path))
      .join('\n');
    expect(source).not.toMatch(/\.scss/);
  });

  it('keeps production Angular imports on explicit package subpaths', () => {
    const source = productionTypeScriptFiles('apps/web/src')
      .map((path) => readRepositoryFile(path))
      .join('\n');

    expect(source).not.toMatch(/from ['"]@ojiepermana\/angular['"]/);
    expect(source).not.toMatch(/import ['"]@ojiepermana\/angular['"]/);
  });
});
