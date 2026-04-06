import { readFile, readdir, stat } from 'fs/promises';
import { join, relative, extname, basename } from 'path';
import { glob } from 'glob';
import type { AnalysisResult, ComponentInfo, FunctionInfo, ApiClientCall, RouteInfo, DependencyInfo } from '../types.js';
import { extractComponents } from './extractors/component.js';
import { extractFunctions } from './extractors/function.js';
import { extractApiCalls } from './extractors/api-call.js';
import { extractRoutes } from './extractors/route.js';
import { detectFramework } from './framework.js';

export interface AnalyzeOptions {
  include?: string[];
  exclude?: string[];
  framework?: string;
}

export async function analyze(sourcePath: string, options: AnalyzeOptions = {}): Promise<AnalysisResult> {
  const framework = options.framework && options.framework !== 'auto'
    ? options.framework
    : await detectFramework(sourcePath);

  const include = options.include || ['**/*.{ts,tsx,js,jsx,mjs,vue}'];
  const exclude = options.exclude || ['node_modules/**', 'dist/**', 'build/**', '.next/**', '**/*.test.*', '**/*.spec.*'];

  // 파일 수집
  const files = await glob(include, {
    cwd: sourcePath,
    ignore: exclude,
    absolute: false,
  });

  let components: ComponentInfo[] = [];
  let functions: FunctionInfo[] = [];
  let apiClients: ApiClientCall[] = [];
  let routes: RouteInfo[] = [];

  // 각 파일 분석
  for (const file of files) {
    const fullPath = join(sourcePath, file);
    const source = await readFile(fullPath, 'utf-8');
    const ext = extname(file);

    try {
      const fileComponents = extractComponents(source, file, ext);
      const fileFunctions = extractFunctions(source, file, ext);
      const fileApiCalls = extractApiCalls(source, file, ext);
      const fileRoutes = extractRoutes(source, file, ext);

      components.push(...fileComponents);
      functions.push(...fileFunctions);
      apiClients.push(...fileApiCalls);
      routes.push(...fileRoutes);
    } catch {
      // 파싱 실패한 파일은 건너뜀
    }
  }

  // 역참조 구축
  buildReverseReferences(functions, components);

  // 의존성 추출
  const dependencies = await extractDependencies(sourcePath);

  return {
    sourcePath,
    framework,
    components,
    routes,
    functions,
    apiClients,
    dependencies,
  };
}

function buildReverseReferences(functions: FunctionInfo[], components: ComponentInfo[]) {
  // calledBy
  for (const func of functions) {
    for (const callee of func.calls) {
      const target = functions.find(f => f.name === callee);
      if (target && !target.calledBy.includes(func.name)) {
        target.calledBy.push(func.name);
      }
    }
  }
  // usedBy
  for (const comp of components) {
    for (const child of comp.children) {
      const target = components.find(c => c.name === child);
      if (target && !target.usedBy.includes(comp.name)) {
        target.usedBy.push(comp.name);
      }
    }
  }
}

async function extractDependencies(sourcePath: string): Promise<DependencyInfo[]> {
  const deps: DependencyInfo[] = [];
  const pkgPath = join(sourcePath, 'package.json');

  try {
    const content = JSON.parse(await readFile(pkgPath, 'utf-8'));

    for (const [name, version] of Object.entries(content.dependencies || {})) {
      deps.push({ name, currentVersion: version as string, depType: 'Production' });
    }
    for (const [name, version] of Object.entries(content.devDependencies || {})) {
      deps.push({ name, currentVersion: version as string, depType: 'Development' });
    }
    for (const [name, version] of Object.entries(content.peerDependencies || {})) {
      deps.push({ name, currentVersion: version as string, depType: 'Peer' });
    }
  } catch { /* no package.json */ }

  return deps;
}
