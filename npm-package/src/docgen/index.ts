import ExcelJS from 'exceljs';
import { writeFile, mkdir } from 'fs/promises';
import type { AnalysisResult } from '../types.js';

export interface ReportOptions {
  formats?: ('excel' | 'mermaid')[];
  outputDir?: string;
}

export async function generateReport(data: AnalysisResult, options: ReportOptions = {}): Promise<string[]> {
  const formats = options.formats || ['excel', 'mermaid'];
  const outputDir = options.outputDir || 'output/reports';
  await mkdir(outputDir, { recursive: true });

  const outputs: string[] = [];

  if (formats.includes('excel')) {
    outputs.push(await generateExcel(data, outputDir));
  }
  if (formats.includes('mermaid')) {
    outputs.push(await generateMermaid(data, outputDir));
  }

  return outputs;
}

async function generateExcel(data: AnalysisResult, outDir: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'reverse-engine';
  const hs: Partial<ExcelJS.Style> = {
    font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B579A' } },
    alignment: { horizontal: 'center', vertical: 'middle' },
  };

  // 컴포넌트
  const s1 = wb.addWorksheet('컴포넌트 목록');
  s1.columns = [
    { header: 'No', width: 6 }, { header: '컴포넌트명', width: 20 },
    { header: '파일 경로', width: 35 }, { header: '타입', width: 12 },
    { header: '하위 컴포넌트', width: 30 }, { header: '사용처', width: 20 },
    { header: 'Hooks', width: 25 }, { header: 'API 호출', width: 30 },
  ];
  s1.getRow(1).eachCell(c => { c.style = hs as ExcelJS.Style; });
  data.components.forEach((c, i) => s1.addRow([
    i + 1, c.name, c.filePath, c.componentType,
    c.children.join(', '), c.usedBy.join(', '),
    c.hooks.join(', '), c.apiCalls.join(', '),
  ]));

  // API
  const s2 = wb.addWorksheet('API 엔드포인트');
  s2.columns = [
    { header: 'No', width: 6 }, { header: 'Method', width: 10 },
    { header: 'URL', width: 35 }, { header: '파일', width: 35 },
    { header: '함수', width: 25 }, { header: '라인', width: 8 },
  ];
  s2.getRow(1).eachCell(c => { c.style = hs as ExcelJS.Style; });
  data.apiClients.forEach((a, i) => s2.addRow([i + 1, a.method, a.urlPattern, a.filePath, a.functionName, a.line]));

  // 라우트
  const s3 = wb.addWorksheet('라우트');
  s3.columns = [
    { header: 'No', width: 6 }, { header: 'Path', width: 25 },
    { header: 'Component', width: 25 }, { header: '파일', width: 35 },
  ];
  s3.getRow(1).eachCell(c => { c.style = hs as ExcelJS.Style; });
  data.routes.forEach((r, i) => s3.addRow([i + 1, r.path, r.component, r.filePath]));

  // 함수
  const s4 = wb.addWorksheet('함수 호출 체인');
  s4.columns = [
    { header: 'No', width: 6 }, { header: '함수명', width: 25 },
    { header: '파일', width: 35 }, { header: 'Async', width: 8 },
    { header: 'Export', width: 8 }, { header: '호출하는 함수', width: 40 },
    { header: '호출되는 곳', width: 25 },
  ];
  s4.getRow(1).eachCell(c => { c.style = hs as ExcelJS.Style; });
  data.functions.forEach((f, i) => s4.addRow([
    i + 1, f.name, f.filePath, f.isAsync ? 'Y' : 'N', f.isExported ? 'Y' : 'N',
    f.calls.join(', '), f.calledBy.join(', '),
  ]));

  // 의존성
  const s5 = wb.addWorksheet('의존성 패키지');
  s5.columns = [
    { header: 'No', width: 6 }, { header: '패키지명', width: 30 },
    { header: '현재 버전', width: 15 }, { header: '타입', width: 15 },
  ];
  s5.getRow(1).eachCell(c => { c.style = hs as ExcelJS.Style; });
  data.dependencies.forEach((d, i) => s5.addRow([i + 1, d.name, d.currentVersion, d.depType]));

  const path = `${outDir}/reverseng-report.xlsx`;
  await wb.xlsx.writeFile(path);
  return path;
}

async function generateMermaid(data: AnalysisResult, outDir: string): Promise<string> {
  const cm: Record<string, string> = {};
  let mm = 'graph TD\n';

  data.components.forEach((c, i) => {
    cm[c.name] = `C${i}`;
    mm += `    C${i}["${c.name}"]\n`;
  });
  data.components.forEach((c, i) => {
    c.children.forEach(ch => { if (cm[ch]) mm += `    C${i} --> ${cm[ch]}\n`; });
  });
  data.routes.forEach((r, i) => {
    if (cm[r.component]) mm += `    R${i}("${r.path}") -.-> ${cm[r.component]}\n`;
  });

  mm += '\n    classDef page fill:#e74c3c,color:#fff\n';
  mm += '    classDef widget fill:#3498db,color:#fff\n';
  mm += '    classDef layout fill:#2ecc71,color:#fff\n';
  data.components.forEach((c, i) => {
    const cls = c.componentType === 'Page' ? 'page' : c.componentType === 'Layout' ? 'layout' : 'widget';
    mm += `    class C${i} ${cls}\n`;
  });

  const path = `${outDir}/component-graph.mmd`;
  await writeFile(path, mm, 'utf-8');
  return path;
}
