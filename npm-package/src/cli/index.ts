#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { createRequire } from 'module';
import { analyze } from '../analyzer/index.js';
import { generateReport } from '../docgen/index.js';
import { generateTests } from '../testgen/index.js';

// ─── 기본값 ───

const DEFAULT_OUTPUT = '.reverse-engine';

/** 프로젝트 루트 자동 감지: package.json 또는 .git이 있는 디렉토리 */
function detectProjectRoot(startDir: string = process.cwd()): string {
  let dir = resolve(startDir);

  while (dir) {
    if (existsSync(join(dir, 'package.json')) ||
        existsSync(join(dir, 'pyproject.toml')) ||
        existsSync(join(dir, '.git'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return process.cwd();
}

/** 출력 디렉토리 경로 resolve */
function resolveOutput(outputOpt?: string, sourcePath?: string): string {
  if (outputOpt) return resolve(outputOpt);
  const base = sourcePath ? resolve(sourcePath) : process.cwd();
  return join(base, DEFAULT_OUTPUT);
}

// ─── 네이티브 바이너리 탐색 ───

function findNativeBinary(): string | null {
  const key = `${process.platform}-${process.arch}`;
  const pkgName = `reverse-engine-${key}`;
  const binName = process.platform === 'win32' ? 'reverseng.exe' : 'reverseng';

  try {
    const req = createRequire(import.meta.url);
    const pkgJsonPath = req.resolve(`${pkgName}/package.json`);
    const binPath = join(dirname(pkgJsonPath), 'bin', binName);
    if (existsSync(binPath)) return binPath;
  } catch { /* not installed */ }

  return null;
}

function runNative(args: string[]) {
  if (!nativeBin) return;
  execFileSync(nativeBin, args, { stdio: 'inherit' });
}

const nativeBin = findNativeBinary();
const program = new Command();

if (nativeBin) {
  console.log(chalk.dim(`⚡ native`));
}

program
  .name('reverse-engine')
  .version('0.2.0')
  .description('웹 서비스 역분석 자동화 도구');

// ─── analyze ───

program
  .command('analyze')
  .argument('[path]', '소스코드 경로 (생략하면 현재 디렉토리에서 자동 감지)')
  .option('--framework <name>', '프레임워크 지정', 'auto')
  .option('--include <patterns>', '포함 패턴 (쉼표 구분)')
  .option('-o, --output <dir>', '출력 디렉토리')
  .description('소스코드 정적 분석')
  .action(async (path: string | undefined, opts: any) => {
    const sourcePath = path ? resolve(path) : detectProjectRoot();
    const outputDir = resolveOutput(opts.output, sourcePath);

    if (nativeBin) {
      runNative(['analyze', sourcePath, '--framework', opts.framework]);
      return;
    }

    console.log(chalk.green('▶'), '코드 분석:', chalk.cyan(sourcePath));

    const result = await analyze(sourcePath, {
      framework: opts.framework,
      include: opts.include?.split(','),
    });

    console.log(chalk.green('✓'), '분석 완료!');
    console.log(`  프레임워크: ${result.framework}`);
    console.log(`  컴포넌트 ${result.components.length} | 함수 ${result.functions.length} | API ${result.apiClients.length} | 라우트 ${result.routes.length} | 의존성 ${result.dependencies.length}`);

    await mkdir(outputDir, { recursive: true });
    const outputPath = join(outputDir, 'analysis.json');
    await writeFile(outputPath, JSON.stringify(result, null, 2));
    console.log(`  → ${chalk.cyan(outputPath)}`);
  });

// ─── report ───

program
  .command('report')
  .description('분석 결과로 리포트 생성 (Excel, Mermaid)')
  .option('--input <file>', '분석 결과 JSON (생략하면 .reverse-engine/analysis.json)')
  .option('--format <formats>', '출력 형식', 'excel,mermaid')
  .option('-o, --output <dir>', '출력 디렉토리')
  .action(async (opts: any) => {
    const inputPath = opts.input || join(DEFAULT_OUTPUT, 'analysis.json');
    if (!existsSync(inputPath)) {
      console.log(chalk.red('✗'), `분석 결과를 찾을 수 없습니다: ${inputPath}`);
      console.log(`  먼저 ${chalk.cyan('reverse-engine analyze')} 를 실행하세요.`);
      process.exit(1);
    }

    const outputDir = opts.output || join(dirname(inputPath), 'reports');
    const data = JSON.parse(await readFile(inputPath, 'utf-8'));
    const formats = opts.format.split(',') as ('excel' | 'mermaid')[];

    console.log(chalk.green('▶'), '리포트 생성');
    const outputs = await generateReport(data, { formats, outputDir });
    console.log(chalk.green('✓'), '완료!');
    outputs.forEach(p => console.log(`  → ${chalk.cyan(p)}`));
  });

// ─── test ───

program
  .command('test')
  .description('테스트 코드 자동 생성')
  .option('--input <file>', '분석 결과 JSON (생략하면 .reverse-engine/analysis.json)')
  .option('--type <types>', '테스트 종류', 'e2e,api')
  .option('-o, --output <dir>', '출력 디렉토리')
  .action(async (opts: any) => {
    const inputPath = opts.input || join(DEFAULT_OUTPUT, 'analysis.json');
    if (!existsSync(inputPath)) {
      console.log(chalk.red('✗'), `분석 결과를 찾을 수 없습니다: ${inputPath}`);
      console.log(`  먼저 ${chalk.cyan('reverse-engine analyze')} 를 실행하세요.`);
      process.exit(1);
    }

    const outputDir = opts.output || join(dirname(inputPath), 'tests');
    const data = JSON.parse(await readFile(inputPath, 'utf-8'));
    const types = opts.type.split(',') as ('e2e' | 'api')[];

    console.log(chalk.green('▶'), '테스트 코드 생성');
    const files = await generateTests(data, { types, outputDir });
    console.log(chalk.green('✓'), `완료! (${files.length}개 파일)`);
    files.forEach(p => console.log(`  → ${chalk.cyan(p)}`));
  });

// ─── full ───

program
  .command('full')
  .argument('[path]', '소스코드 경로 (생략하면 현재 디렉토리)')
  .option('--framework <name>', '프레임워크', 'auto')
  .option('-o, --output <dir>', '출력 디렉토리 (기본: <프로젝트>/.reverse-engine)')
  .description('전체 파이프라인 (analyze → report → test)')
  .action(async (path: string | undefined, opts: any) => {
    const sourcePath = path ? resolve(path) : detectProjectRoot();
    const outputDir = resolveOutput(opts.output, sourcePath);

    console.log(chalk.green('\n◆'), 'ReversEngine',
      nativeBin ? chalk.dim('⚡') : '', '\n');
    console.log(`  소스: ${chalk.cyan(sourcePath)}`);
    console.log(`  출력: ${chalk.cyan(outputDir)}\n`);

    await mkdir(outputDir, { recursive: true });
    const analysisPath = join(outputDir, 'analysis.json');

    // Step 1: 분석
    console.log(chalk.gray('━'.repeat(50)));
    if (nativeBin) {
      runNative(['analyze', sourcePath, '--framework', opts.framework || 'auto']);
    } else {
      const result = await analyze(sourcePath, { framework: opts.framework });
      console.log(chalk.green('✓'), `분석: 컴포넌트 ${result.components.length} | 함수 ${result.functions.length} | API ${result.apiClients.length} | 라우트 ${result.routes.length}`);
      await writeFile(analysisPath, JSON.stringify(result, null, 2));
    }

    // Step 2: 리포트
    if (existsSync(analysisPath)) {
      const data = JSON.parse(await readFile(analysisPath, 'utf-8'));

      console.log(chalk.gray('━'.repeat(50)));
      const reports = await generateReport(data, { outputDir: join(outputDir, 'reports') });
      console.log(chalk.green('✓'), '리포트:', reports.map(p => chalk.cyan(p.split('/').pop())).join(', '));

      // Step 3: 테스트
      console.log(chalk.gray('━'.repeat(50)));
      const tests = await generateTests(data, { outputDir: join(outputDir, 'tests') });
      console.log(chalk.green('✓'), `테스트: ${tests.length}개 파일`);
    }

    console.log(chalk.gray('━'.repeat(50)));
    console.log(chalk.green('\n✓'), '완료!', chalk.dim(outputDir), '\n');
  });

// ─── 기본 명령 (인자 없이 실행 시 full과 동일) ───

program
  .action(async () => {
    // 아무 서브커맨드 없이 실행하면 full 실행
    const sourcePath = detectProjectRoot();
    const outputDir = resolveOutput(undefined, sourcePath);

    if (!existsSync(join(sourcePath, 'package.json')) && !existsSync(join(sourcePath, '.git'))) {
      program.help();
      return;
    }

    console.log(chalk.green('\n◆'), 'ReversEngine',
      nativeBin ? chalk.dim('⚡') : '', '\n');
    console.log(`  소스: ${chalk.cyan(sourcePath)}`);
    console.log(`  출력: ${chalk.cyan(outputDir)}\n`);

    await mkdir(outputDir, { recursive: true });
    const analysisPath = join(outputDir, 'analysis.json');

    console.log(chalk.gray('━'.repeat(50)));
    const result = await analyze(sourcePath, {});
    console.log(chalk.green('✓'), `분석: 컴포넌트 ${result.components.length} | 함수 ${result.functions.length} | API ${result.apiClients.length} | 라우트 ${result.routes.length}`);
    await writeFile(analysisPath, JSON.stringify(result, null, 2));

    const data = JSON.parse(await readFile(analysisPath, 'utf-8'));

    console.log(chalk.gray('━'.repeat(50)));
    const reports = await generateReport(data, { outputDir: join(outputDir, 'reports') });
    console.log(chalk.green('✓'), '리포트:', reports.map(p => chalk.cyan(p.split('/').pop())).join(', '));

    console.log(chalk.gray('━'.repeat(50)));
    const tests = await generateTests(data, { outputDir: join(outputDir, 'tests') });
    console.log(chalk.green('✓'), `테스트: ${tests.length}개 파일`);

    console.log(chalk.gray('━'.repeat(50)));
    console.log(chalk.green('\n✓'), '완료!', chalk.dim(outputDir), '\n');
  });

program.parse();
