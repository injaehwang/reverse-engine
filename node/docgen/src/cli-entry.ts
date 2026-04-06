/**
 * CLI에서 직접 호출되는 진입점
 * Usage: node cli-entry.js <input-json> <output-dir> <formats>
 */

import ExcelJS from 'exceljs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

const { Workbook } = ExcelJS;

const [,, inputPath, outputDir, formatsArg] = process.argv;

if (!inputPath || !outputDir) {
  console.error('Usage: node cli-entry.js <input.json> <output-dir> [excel,mermaid]');
  process.exit(1);
}

const formats = (formatsArg || 'excel,mermaid').split(',');

async function main() {
  const data = JSON.parse(await readFile(inputPath, 'utf-8'));
  await mkdir(outputDir, { recursive: true });

  const results: string[] = [];

  if (formats.includes('excel')) {
    const path = await generateExcel(data, outputDir);
    results.push(path);
  }

  if (formats.includes('mermaid')) {
    const path = await generateMermaid(data, outputDir);
    results.push(path);
  }

  // 결과를 JSON으로 stdout 출력
  const response = JSON.stringify({ success: true, data: { outputs: results } });
  process.stdout.write(response);
}

async function generateExcel(data: any, outDir: string): Promise<string> {
  const workbook = new Workbook();
  workbook.creator = 'ReversEngine';

  const hs: any = {
    font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B579A' } },
    alignment: { horizontal: 'center', vertical: 'middle' },
  };

  // Sheet 1: 컴포넌트
  const s1 = workbook.addWorksheet('컴포넌트 목록');
  s1.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: '컴포넌트명', key: 'name', width: 20 },
    { header: '파일 경로', key: 'file', width: 35 },
    { header: '타입', key: 'type', width: 12 },
    { header: '하위 컴포넌트', key: 'children', width: 30 },
    { header: '사용처', key: 'used_by', width: 20 },
    { header: 'Hooks', key: 'hooks', width: 25 },
    { header: 'API 호출', key: 'apis', width: 30 },
  ];
  s1.getRow(1).eachCell((c) => { c.style = hs; });
  (data.components || []).forEach((c: any, i: number) => {
    s1.addRow({
      no: i + 1, name: c.name, file: c.file_path,
      type: c.component_type, children: (c.children || []).join(', '),
      used_by: (c.used_by || []).join(', '), hooks: (c.hooks || []).join(', '),
      apis: (c.api_calls || []).join(', '),
    });
  });

  // Sheet 2: API 엔드포인트
  const s2 = workbook.addWorksheet('API 엔드포인트');
  s2.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: 'Method', key: 'method', width: 10 },
    { header: 'URL', key: 'url', width: 35 },
    { header: '파일', key: 'file', width: 35 },
    { header: '함수', key: 'func', width: 25 },
    { header: '라인', key: 'line', width: 8 },
  ];
  s2.getRow(1).eachCell((c) => { c.style = hs; });
  (data.api_clients || []).forEach((a: any, i: number) => {
    s2.addRow({ no: i + 1, method: a.method, url: a.url_pattern, file: a.file_path, func: a.function_name, line: a.line });
  });

  // Sheet 3: 라우트
  const s3 = workbook.addWorksheet('라우트');
  s3.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: 'Path', key: 'path', width: 25 },
    { header: 'Component', key: 'comp', width: 25 },
    { header: '파일', key: 'file', width: 35 },
  ];
  s3.getRow(1).eachCell((c) => { c.style = hs; });
  (data.routes || []).forEach((r: any, i: number) => {
    s3.addRow({ no: i + 1, path: r.path, comp: r.component, file: r.file_path });
  });

  // Sheet 4: 함수 호출 체인
  const s4 = workbook.addWorksheet('함수 호출 체인');
  s4.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: '함수명', key: 'name', width: 25 },
    { header: '파일', key: 'file', width: 35 },
    { header: 'Async', key: 'async', width: 8 },
    { header: 'Export', key: 'export', width: 8 },
    { header: '호출하는 함수', key: 'calls', width: 40 },
    { header: '호출되는 곳', key: 'called_by', width: 25 },
  ];
  s4.getRow(1).eachCell((c) => { c.style = hs; });
  (data.functions || []).forEach((f: any, i: number) => {
    s4.addRow({
      no: i + 1, name: f.name, file: f.file_path,
      async: f.is_async ? 'Y' : 'N', export: f.is_exported ? 'Y' : 'N',
      calls: (f.calls || []).join(', '), called_by: (f.called_by || []).join(', '),
    });
  });

  // Sheet 5: 의존성 패키지
  const s5 = workbook.addWorksheet('의존성 패키지');
  s5.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: '패키지명', key: 'name', width: 30 },
    { header: '현재 버전', key: 'ver', width: 15 },
    { header: '타입', key: 'type', width: 15 },
  ];
  s5.getRow(1).eachCell((c) => { c.style = hs; });
  (data.dependencies || []).forEach((d: any, i: number) => {
    s5.addRow({ no: i + 1, name: d.name, ver: d.current_version, type: d.dep_type });
  });

  const filePath = `${outDir}/reverseng-report.xlsx`;
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

async function generateMermaid(data: any, outDir: string): Promise<string> {
  const components = data.components || [];
  const routes = data.routes || [];
  const cm: Record<string, string> = {};

  let mm = 'graph TD\n';
  components.forEach((c: any, i: number) => {
    cm[c.name] = `C${i}`;
    mm += `    C${i}["${c.name}"]\n`;
  });
  components.forEach((c: any, i: number) => {
    (c.children || []).forEach((ch: string) => {
      if (cm[ch]) mm += `    C${i} --> ${cm[ch]}\n`;
    });
  });
  routes.forEach((r: any, i: number) => {
    const comp = r.component.replace(/[<>/]/g, '').trim();
    if (cm[comp]) mm += `    R${i}("${r.path}") -.-> ${cm[comp]}\n`;
  });

  mm += '\n    classDef page fill:#e74c3c,color:#fff\n';
  mm += '    classDef widget fill:#3498db,color:#fff\n';
  mm += '    classDef layout fill:#2ecc71,color:#fff\n';
  components.forEach((c: any, i: number) => {
    if (c.component_type === 'Page') mm += `    class C${i} page\n`;
    else if (c.component_type === 'Layout') mm += `    class C${i} layout\n`;
    else mm += `    class C${i} widget\n`;
  });

  const filePath = `${outDir}/component-graph.mmd`;
  await writeFile(filePath, mm, 'utf-8');
  return filePath;
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ success: false, error: String(e) }));
  process.exit(1);
});
