/**
 * Markdown 보고서 생성 - Excel과 동일한 6개 섹션
 */

import { mkdir, writeFile } from 'fs/promises';
import path from 'node:path';

export async function generateMarkdown(data: any, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });

  const sections = [
    generateHeader(data),
    generateComponentsSection(data),
    generateRoutesSection(data),
    generateApiClientsSection(data),
    generateFunctionsSection(data),
    generateDependenciesSection(data),
    generateStateStoresSection(data),
  ];

  const content = sections.filter(Boolean).join('\n\n---\n\n');
  const filePath = path.join(outputDir, 'reverseng-report.md');
  await writeFile(filePath, content, 'utf-8');

  return filePath;
}

function generateHeader(data: any): string {
  const lines = [
    `# ReversEngine 분석 보고서`,
    '',
    `| 항목 | 값 |`,
    `|------|-----|`,
    `| 프로젝트 경로 | \`${data.source_path || '-'}\` |`,
    `| 프레임워크 | ${data.framework || 'Unknown'} |`,
    `| 컴포넌트 | ${data.components?.length || 0}개 |`,
    `| 라우트 | ${data.routes?.length || 0}개 |`,
    `| 함수 | ${data.functions?.length || 0}개 |`,
    `| API 클라이언트 | ${data.api_clients?.length || 0}개 |`,
    `| 상태 스토어 | ${data.state_stores?.length || 0}개 |`,
    `| 의존성 | ${data.dependencies?.length || 0}개 |`,
  ];
  return lines.join('\n');
}

function generateComponentsSection(data: any): string {
  const components = data.components || [];
  if (components.length === 0) return '';

  const lines = [
    `## 컴포넌트 목록`,
    '',
    `| No | 컴포넌트명 | 파일경로 | 타입 | Props | Children | Hooks | API 호출 |`,
    `|----|-----------|----------|------|-------|----------|-------|---------|`,
  ];

  components.forEach((c: any, i: number) => {
    lines.push(
      `| ${i + 1} | **${escCell(c.name)}** | \`${escCell(c.file_path)}\` | ${c.component_type} | ${(c.props || []).map((p: any) => p?.name || '').join(', ') || '-'} | ${(c.children || []).join(', ') || '-'} | ${(c.hooks || []).join(', ') || '-'} | ${(c.api_calls || []).join(', ') || '-'} |`,
    );
  });

  return lines.join('\n');
}

function generateRoutesSection(data: any): string {
  const routes = data.routes || [];
  if (routes.length === 0) return '';

  const lines = [
    `## 라우트 매핑`,
    '',
    `| No | 경로 | 컴포넌트 | 파일 | 가드 |`,
    `|----|------|---------|------|------|`,
  ];

  routes.forEach((r: any, i: number) => {
    lines.push(
      `| ${i + 1} | \`${r.path}\` | ${r.component} | \`${r.file_path}\` | ${(r.guards || []).join(', ') || '-'} |`,
    );
  });

  return lines.join('\n');
}

function generateApiClientsSection(data: any): string {
  const apis = data.api_clients || [];
  if (apis.length === 0) return '';

  const lines = [
    `## API 클라이언트 호출`,
    '',
    `| No | Method | URL 패턴 | 파일 | 함수 | 라인 |`,
    `|----|--------|----------|------|------|------|`,
  ];

  apis.forEach((a: any, i: number) => {
    lines.push(
      `| ${i + 1} | \`${a.method}\` | \`${a.url_pattern}\` | \`${a.file_path}\` | ${a.function_name} | ${a.line} |`,
    );
  });

  return lines.join('\n');
}

function generateFunctionsSection(data: any): string {
  const functions = data.functions || [];
  if (functions.length === 0) return '';

  // 주요 함수만 표시 (exported 또는 다른 함수에서 호출되는 것)
  const notable = functions.filter(
    (f: any) => f.is_exported || (f.called_by && f.called_by.length > 0),
  );

  const lines = [
    `## 함수 호출 체인`,
    '',
    `> 전체 ${functions.length}개 함수 중 주요 ${notable.length}개 표시`,
    '',
    `| No | 함수명 | 파일 | 호출하는 함수 | 호출되는 곳 | async | exported |`,
    `|----|--------|------|-------------|------------|-------|----------|`,
  ];

  notable.forEach((f: any, i: number) => {
    lines.push(
      `| ${i + 1} | **${f.name}** | \`${f.file_path}\` | ${(f.calls || []).slice(0, 5).join(', ') || '-'} | ${(f.called_by || []).join(', ') || '-'} | ${f.is_async ? '✓' : '-'} | ${f.is_exported ? '✓' : '-'} |`,
    );
  });

  return lines.join('\n');
}

function generateDependenciesSection(data: any): string {
  const deps = data.dependencies || [];
  if (deps.length === 0) return '';

  const prod = deps.filter((d: any) => d.dep_type === 'Production');
  const dev = deps.filter((d: any) => d.dep_type === 'Development');

  const lines = [
    `## 의존성 패키지`,
    '',
    `### Production (${prod.length}개)`,
    '',
    `| 패키지명 | 버전 | 취약점 |`,
    `|----------|------|--------|`,
  ];

  prod.forEach((d: any) => {
    const vulns = (d.vulnerabilities || []).length;
    lines.push(
      `| ${d.name} | ${d.current_version} | ${vulns > 0 ? `⚠ ${vulns}개` : '없음'} |`,
    );
  });

  if (dev.length > 0) {
    lines.push('', `### Development (${dev.length}개)`, '', `| 패키지명 | 버전 |`, `|----------|------|`);
    dev.forEach((d: any) => {
      lines.push(`| ${d.name} | ${d.current_version} |`);
    });
  }

  return lines.join('\n');
}

/** Markdown 테이블 셀 이스케이프 */
function escCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function generateStateStoresSection(data: any): string {
  const stores = data.state_stores || [];
  if (stores.length === 0) return '';

  const lines = [
    `## 상태 관리 스토어`,
    '',
    `| No | 이름 | 타입 | 파일 | State 키 | Actions |`,
    `|----|------|------|------|----------|---------|`,
  ];

  stores.forEach((s: any, i: number) => {
    lines.push(
      `| ${i + 1} | **${s.name}** | ${s.store_type} | \`${s.file_path}\` | ${(s.state_keys || []).join(', ') || '-'} | ${(s.actions || []).join(', ') || '-'} |`,
    );
  });

  return lines.join('\n');
}
