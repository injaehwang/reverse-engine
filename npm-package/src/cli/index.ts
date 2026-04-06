#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { createRequire } from 'module';
import { analyze } from '../analyzer/index.js';
import { crawl } from '../crawler/index.js';
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

// ─── crawl ───

program
  .command('crawl')
  .argument('[url]', '크롤링 대상 URL')
  .option('--max-depth <n>', '최대 탐색 깊이', '5')
  .option('--max-pages <n>', '최대 페이지 수', '100')
  .option('--no-screenshot', '스크린샷 비활성화')
  .option('--no-headless', '브라우저 표시 (디버깅용)')
  .option('--auth-cookie <cookie>', '인증 쿠키 (name=value;name2=value2)')
  .option('--auth-bearer <token>', 'Bearer 토큰')
  .option('--login-url <url>', '로그인 페이지 URL')
  .option('--login-id <id>', '로그인 ID 필드값')
  .option('--login-pw <pw>', '로그인 PW 필드값')
  .option('--wait <ms>', '페이지 로드 후 대기시간(ms)', '1500')
  .option('-o, --output <dir>', '출력 디렉토리')
  .description('실행 중인 서비스를 브라우저로 크롤링하여 화면/API 수집')
  .action(async (url: string | undefined, opts: any) => {
    if (!url) {
      console.log(chalk.red('✗'), 'URL을 입력하세요: reverse-engine crawl http://localhost:3000');
      process.exit(1);
    }

    const outputDir = opts.output || DEFAULT_OUTPUT;
    console.log(chalk.green('▶'), '크롤링 시작:', chalk.cyan(url));
    console.log(`  최대 깊이: ${opts.maxDepth} | 최대 페이지: ${opts.maxPages}`);

    // 인증 옵션 구성
    const auth: any = {};
    if (opts.authCookie) auth.cookie = opts.authCookie;
    if (opts.authBearer) auth.bearer = opts.authBearer;
    if (opts.loginUrl) {
      auth.loginUrl = opts.loginUrl;
      auth.credentials = {};
      if (opts.loginId) auth.credentials.email = opts.loginId;
      if (opts.loginPw) auth.credentials.password = opts.loginPw;
    }

    const result = await crawl({
      url,
      maxDepth: parseInt(opts.maxDepth),
      maxPages: parseInt(opts.maxPages),
      screenshot: opts.screenshot !== false,
      headless: opts.headless !== false,
      outputDir,
      waitTime: parseInt(opts.wait),
      auth: Object.keys(auth).length > 0 ? auth : undefined,
    });

    console.log(chalk.green('✓'), `크롤링 완료!`);
    console.log(`  페이지: ${result.pages.length}개`);
    console.log(`  API 호출: ${result.pages.reduce((n, p) => n + p.apiCalls.length, 0)}개`);

    await mkdir(outputDir, { recursive: true });
    const crawlPath = join(outputDir, 'crawl-result.json');
    await writeFile(crawlPath, JSON.stringify(result, null, 2));
    console.log(`  → ${chalk.cyan(crawlPath)}`);
  });

// ─── full ───

program
  .command('full')
  .argument('[path]', '소스코드 경로 (생략하면 현재 디렉토리)')
  .option('--url <url>', '실행 중인 서비스 URL (크롤링 추가)')
  .option('--framework <name>', '프레임워크', 'auto')
  .option('--no-headless', '크롤링 시 브라우저 표시')
  .option('--auth-cookie <cookie>', '크롤링 인증 쿠키')
  .option('-o, --output <dir>', '출력 디렉토리 (기본: <프로젝트>/.reverse-engine)')
  .description('전체 파이프라인 (crawl → analyze → report → test)')
  .action(async (path: string | undefined, opts: any) => {
    const sourcePath = path ? resolve(path) : detectProjectRoot();
    const outputDir = resolveOutput(opts.output, sourcePath);

    console.log(chalk.green('\n◆'), 'ReversEngine',
      nativeBin ? chalk.dim('⚡') : '', '\n');
    if (opts.url) console.log(`  URL:  ${chalk.cyan(opts.url)}`);
    console.log(`  소스: ${chalk.cyan(sourcePath)}`);
    console.log(`  출력: ${chalk.cyan(outputDir)}\n`);

    await mkdir(outputDir, { recursive: true });
    const analysisPath = join(outputDir, 'analysis.json');

    // Step 0: 크롤링 (URL이 있는 경우)
    if (opts.url) {
      console.log(chalk.gray('━'.repeat(50)));
      console.log(chalk.green('▶'), '크롤링:', chalk.cyan(opts.url));
      const crawlResult = await crawl({
        url: opts.url,
        outputDir,
        headless: opts.headless !== false,
        auth: opts.authCookie ? { cookie: opts.authCookie } : undefined,
      });
      console.log(chalk.green('✓'), `크롤링: 페이지 ${crawlResult.pages.length} | API ${crawlResult.pages.reduce((n, p) => n + p.apiCalls.length, 0)}`);
      await writeFile(join(outputDir, 'crawl-result.json'), JSON.stringify(crawlResult, null, 2));
    }

    // Step 1: 코드 분석
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
