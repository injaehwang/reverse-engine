#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { analyze } from '../analyzer/index.js';
import { generateReport } from '../docgen/index.js';
import { generateTests } from '../testgen/index.js';

const program = new Command();

program
  .name('reverse-engine')
  .version('0.1.0')
  .description('웹 서비스 역분석 자동화 도구 - 소스코드 분석, 문서 생성, 테스트 자동화');

// analyze
program
  .command('analyze <path>')
  .description('소스코드 정적 분석')
  .option('--framework <name>', '프레임워크 지정 (auto, react, vue, angular, next)', 'auto')
  .option('--include <patterns>', '포함 패턴 (쉼표 구분)', 'src/**/*.{ts,tsx,js,jsx,vue}')
  .option('--output <dir>', '출력 디렉토리', './output')
  .action(async (sourcePath: string, opts: any) => {
    console.log(chalk.green('▶'), '코드 분석 시작:', chalk.cyan(sourcePath));

    const result = await analyze(sourcePath, {
      framework: opts.framework,
      include: opts.include.split(','),
    });

    console.log(chalk.green('✓'), '코드 분석 완료!');
    console.log(`  프레임워크: ${result.framework}`);
    console.log(`  컴포넌트: ${result.components.length}개`);
    console.log(`  함수: ${result.functions.length}개`);
    console.log(`  API: ${result.apiClients.length}개`);
    console.log(`  라우트: ${result.routes.length}개`);
    console.log(`  의존성: ${result.dependencies.length}개`);

    await mkdir(opts.output, { recursive: true });
    const outputPath = `${opts.output}/analysis.json`;
    await writeFile(outputPath, JSON.stringify(result, null, 2));
    console.log(`  결과 저장: ${chalk.cyan(outputPath)}`);
  });

// report
program
  .command('report')
  .description('분석 결과로 리포트 생성')
  .requiredOption('--input <file>', '분석 결과 JSON 파일')
  .option('--format <formats>', '출력 형식 (excel,mermaid)', 'excel,mermaid')
  .option('--output <dir>', '출력 디렉토리', './output/reports')
  .action(async (opts: any) => {
    console.log(chalk.green('▶'), '리포트 생성 시작');
    const data = JSON.parse(await readFile(opts.input, 'utf-8'));
    const formats = opts.format.split(',') as ('excel' | 'mermaid')[];

    const outputs = await generateReport(data, { formats, outputDir: opts.output });

    console.log(chalk.green('✓'), '리포트 생성 완료!');
    outputs.forEach(p => console.log(`  → ${chalk.cyan(p)}`));
  });

// test
program
  .command('test')
  .description('테스트 코드 자동 생성')
  .requiredOption('--input <file>', '분석 결과 JSON 파일')
  .option('--type <types>', '테스트 종류 (e2e,api)', 'e2e,api')
  .option('--output <dir>', '출력 디렉토리', './output/tests')
  .action(async (opts: any) => {
    console.log(chalk.green('▶'), '테스트 코드 생성 시작');
    const data = JSON.parse(await readFile(opts.input, 'utf-8'));
    const types = opts.type.split(',') as ('e2e' | 'api')[];

    const files = await generateTests(data, { types, outputDir: opts.output });

    console.log(chalk.green('✓'), `테스트 코드 생성 완료! (${files.length}개 파일)`);
    files.forEach(p => console.log(`  → ${chalk.cyan(p)}`));
  });

// full
program
  .command('full')
  .description('전체 파이프라인 (analyze → report → test)')
  .requiredOption('--source <path>', '소스코드 경로')
  .option('--output <dir>', '출력 디렉토리', './output')
  .option('--framework <name>', '프레임워크', 'auto')
  .action(async (opts: any) => {
    console.log(chalk.green('\n◆'), 'ReversEngine 전체 파이프라인 시작\n');

    // Step 1: 분석
    console.log(chalk.gray('━'.repeat(50)));
    const result = await analyze(opts.source, { framework: opts.framework });
    console.log(chalk.green('✓'), `분석 완료: 컴포넌트 ${result.components.length}, 함수 ${result.functions.length}, API ${result.apiClients.length}, 라우트 ${result.routes.length}`);

    await mkdir(opts.output, { recursive: true });
    await writeFile(`${opts.output}/analysis.json`, JSON.stringify(result, null, 2));

    // Step 2: 리포트
    console.log(chalk.gray('━'.repeat(50)));
    const reports = await generateReport(result, { outputDir: `${opts.output}/reports` });
    console.log(chalk.green('✓'), '리포트 생성 완료!');
    reports.forEach(p => console.log(`  → ${chalk.cyan(p)}`));

    // Step 3: 테스트
    console.log(chalk.gray('━'.repeat(50)));
    const tests = await generateTests(result, { outputDir: `${opts.output}/tests` });
    console.log(chalk.green('✓'), `테스트 생성 완료! (${tests.length}개)`);
    tests.forEach(p => console.log(`  → ${chalk.cyan(p)}`));

    console.log(chalk.green('\n✓'), '전체 파이프라인 완료!', chalk.cyan(opts.output), '\n');
  });

program.parse();
