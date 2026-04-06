import { readFile } from 'fs/promises';
import { join } from 'path';

export async function detectFramework(sourcePath: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(join(sourcePath, 'package.json'), 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (allDeps['next']) return 'Next.js';
    if (allDeps['nuxt']) return 'Nuxt';
    if (allDeps['@angular/core']) return 'Angular';
    if (allDeps['svelte']) return 'Svelte';
    if (allDeps['vue']) return 'Vue';
    if (allDeps['react']) return 'React';
  } catch { /* no package.json */ }

  return 'Unknown';
}
