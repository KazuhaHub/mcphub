import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../frontend');

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });

describe('dashboard build carries no version', () => {
  it('does not compile the package version into the bundle', () => {
    const config = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
    expect(config).not.toMatch(/PACKAGE_VERSION|package\.json|define\s*:/);

    const offenders = sourceFiles(path.join(root, 'src')).filter((file) =>
      /PACKAGE_VERSION|APP_VERSION/.test(fs.readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
