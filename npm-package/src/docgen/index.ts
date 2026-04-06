import ExcelJS from 'exceljs';
import { writeFile, mkdir } from 'fs/promises';
import type { AnalysisResult } from '../types.js';

export interface ReportOptions {
  formats?: ('excel' | 'mermaid')[];
  outputDir?: string;
}

export async function generateReport(data: any, options: ReportOptions = {}): Promise<string[]> {
  const formats = options.formats || ['excel', 'mermaid'];
  const outputDir = options.outputDir || 'output/reports';
  await mkdir(outputDir, { recursive: true });

  const outputs: string[] = [];

  if (formats.includes('excel')) {
    try {
      outputs.push(await generateExcel(data, outputDir));
    } catch (e: any) {
      if (e.code === 'EBUSY') {
        console.log('  ⚠ Excel 파일이 열려 있어 덮어쓸 수 없습니다. 파일을 닫고 다시 시도하세요.');
      } else {
        throw e;
      }
    }
  }
  if (formats.includes('mermaid')) {
    outputs.push(await generateMermaid(data, outputDir));
  }

  return outputs;
}

async function generateExcel(data: any, outDir: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'reverse-engine';
  const hs: Partial<ExcelJS.Style> = {
    font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B579A' } },
    alignment: { horizontal: 'center', vertical: 'middle' },
  };

  const applyHeader = (sheet: ExcelJS.Worksheet) => {
    sheet.getRow(1).eachCell(c => { c.style = hs as ExcelJS.Style; });
  };

  // ── 크롤링 결과가 있으면: 화면 목록 + API 호출 시트 ──
  const pages = data.pages || [];
  if (pages.length > 0) {
    // 화면 목록
    const sp = wb.addWorksheet('화면 목록');
    sp.columns = [
      { header: 'No', width: 6 }, { header: 'URL', width: 40 },
      { header: '화면명', width: 25 }, { header: '스크린샷', width: 30 },
      { header: '링크 수', width: 8 }, { header: '버튼 수', width: 8 },
      { header: 'API 호출', width: 8 }, { header: '인증필요', width: 8 },
    ];
    applyHeader(sp);
    pages.forEach((p: any, i: number) => sp.addRow([
      i + 1, p.url, p.title || '',
      p.screenshotPath || '-',
      p.elements?.links?.length || 0,
      p.elements?.buttons?.length || 0,
      p.apiCalls?.length || 0,
      p.authRequired ? 'Y' : 'N',
    ]));

    // 화면별 API 호출
    const sa = wb.addWorksheet('API 호출 (크롤링)');
    sa.columns = [
      { header: 'No', width: 6 }, { header: '화면 URL', width: 35 },
      { header: 'Method', width: 10 }, { header: 'API URL', width: 50 },
      { header: 'Status', width: 8 },
    ];
    applyHeader(sa);
    let apiNo = 0;
    pages.forEach((p: any) => {
      (p.apiCalls || []).forEach((api: any) => {
        apiNo++;
        sa.addRow([apiNo, p.url, api.method, api.url, api.responseStatus]);
      });
    });

    // 화면 흐름
    const sf = wb.addWorksheet('화면 흐름');
    sf.columns = [
      { header: 'No', width: 6 }, { header: '출발 화면', width: 40 },
      { header: '트리거', width: 30 }, { header: '도착 화면', width: 40 },
    ];
    applyHeader(sf);
    let flowNo = 0;
    const flowSet = new Set<string>(); // 중복 제거
    pages.forEach((p: any) => {
      // flows 데이터 (크롤링에서 수집)
      (p.flows || []).forEach((flow: any) => {
        const key = `${flow.from}→${flow.to}`;
        if (flowSet.has(key)) return;
        flowSet.add(key);
        flowNo++;
        sf.addRow([flowNo, flow.from, flow.trigger, flow.to]);
      });
      // flows가 없으면 링크/버튼에서 추출
      if (!p.flows || p.flows.length === 0) {
        (p.elements?.links || []).forEach((link: any) => {
          if (link.href && link.href !== p.url) {
            const key = `${p.url}→${link.href}`;
            if (flowSet.has(key)) return;
            flowSet.add(key);
            flowNo++;
            sf.addRow([flowNo, p.url, link.text || link.selector, link.href]);
          }
        });
        (p.elements?.buttons || []).forEach((btn: any) => {
          if (btn.navigatesTo) {
            const key = `${p.url}→${btn.navigatesTo}`;
            if (flowSet.has(key)) return;
            flowSet.add(key);
            flowNo++;
            sf.addRow([flowNo, p.url, btn.text || btn.selector, btn.navigatesTo]);
          }
        });
      }
    });
  }

  // ── 소스코드 분석 결과가 있으면 ──
  const components = data.components || [];
  const apiClients = data.apiClients || [];
  const routes = data.routes || [];
  const functions = data.functions || [];
  const dependencies = data.dependencies || [];

  if (components.length > 0) {
    const s1 = wb.addWorksheet('컴포넌트 목록');
    s1.columns = [
      { header: 'No', width: 6 }, { header: '컴포넌트명', width: 20 },
      { header: '파일 경로', width: 35 }, { header: '타입', width: 12 },
      { header: '하위 컴포넌트', width: 30 }, { header: '사용처', width: 20 },
      { header: 'Hooks', width: 25 }, { header: 'API 호출', width: 30 },
    ];
    applyHeader(s1);
    components.forEach((c: any, i: number) => s1.addRow([
      i + 1, c.name, c.filePath, c.componentType,
      (c.children || []).join(', '), (c.usedBy || []).join(', '),
      (c.hooks || []).join(', '), (c.apiCalls || []).join(', '),
    ]));
  }

  if (apiClients.length > 0) {
    const s2 = wb.addWorksheet('API 엔드포인트 (코드)');
    s2.columns = [
      { header: 'No', width: 6 }, { header: 'Method', width: 10 },
      { header: 'URL', width: 35 }, { header: '파일', width: 35 },
      { header: '함수', width: 25 }, { header: '라인', width: 8 },
    ];
    applyHeader(s2);
    apiClients.forEach((a: any, i: number) => s2.addRow([i + 1, a.method, a.urlPattern, a.filePath, a.functionName, a.line]));
  }

  if (routes.length > 0) {
    const s3 = wb.addWorksheet('라우트');
    s3.columns = [
      { header: 'No', width: 6 }, { header: 'Path', width: 25 },
      { header: 'Component', width: 25 }, { header: '파일', width: 35 },
    ];
    applyHeader(s3);
    routes.forEach((r: any, i: number) => s3.addRow([i + 1, r.path, r.component, r.filePath]));
  }

  if (functions.length > 0) {
    const s4 = wb.addWorksheet('함수 호출 체인');
    s4.columns = [
      { header: 'No', width: 6 }, { header: '함수명', width: 25 },
      { header: '파일', width: 35 }, { header: 'Async', width: 8 },
      { header: 'Export', width: 8 }, { header: '호출하는 함수', width: 40 },
      { header: '호출되는 곳', width: 25 },
    ];
    applyHeader(s4);
    functions.forEach((f: any, i: number) => s4.addRow([
      i + 1, f.name, f.filePath, f.isAsync ? 'Y' : 'N', f.isExported ? 'Y' : 'N',
      (f.calls || []).join(', '), (f.calledBy || []).join(', '),
    ]));
  }

  if (dependencies.length > 0) {
    const s5 = wb.addWorksheet('의존성 패키지');
    s5.columns = [
      { header: 'No', width: 6 }, { header: '패키지명', width: 30 },
      { header: '현재 버전', width: 15 }, { header: '타입', width: 15 },
    ];
    applyHeader(s5);
    dependencies.forEach((d: any, i: number) => s5.addRow([i + 1, d.name, d.currentVersion, d.depType]));
  }

  const path = `${outDir}/reverseng-report.xlsx`;
  await wb.xlsx.writeFile(path);
  return path;
}

async function generateMermaid(data: any, outDir: string): Promise<string> {
  const components = data.components || [];
  const routes = data.routes || [];
  const pages = data.pages || [];

  // 크롤링 결과가 있으면 화면 흐름도
  if (pages.length > 0 && components.length === 0) {
    return generateCrawlMermaid(pages, outDir);
  }

  // 소스코드 분석 결과 → 컴포넌트 관계도
  const cm: Record<string, string> = {};
  let mm = 'graph TD\n';

  components.forEach((c: any, i: number) => {
    cm[c.name] = `C${i}`;
    mm += `    C${i}["${c.name}"]\n`;
  });
  components.forEach((c: any, i: number) => {
    (c.children || []).forEach((ch: string) => { if (cm[ch]) mm += `    C${i} --> ${cm[ch]}\n`; });
  });
  routes.forEach((r: any, i: number) => {
    if (cm[r.component]) mm += `    R${i}("${r.path}") -.-> ${cm[r.component]}\n`;
  });

  mm += '\n    classDef page fill:#e74c3c,color:#fff\n';
  mm += '    classDef widget fill:#3498db,color:#fff\n';
  mm += '    classDef layout fill:#2ecc71,color:#fff\n';
  components.forEach((c: any, i: number) => {
    const cls = c.componentType === 'Page' ? 'page' : c.componentType === 'Layout' ? 'layout' : 'widget';
    mm += `    class C${i} ${cls}\n`;
  });

  const path = `${outDir}/component-graph.mmd`;
  await writeFile(path, mm, 'utf-8');
  return path;
}

async function generateCrawlMermaid(pages: any[], outDir: string): Promise<string> {
  const pm: Record<string, string> = {};
  let mm = 'graph TD\n';

  pages.forEach((p: any, i: number) => {
    const id = `P${i}`;
    const label = p.title || new URL(p.url).pathname;
    pm[p.url] = id;
    mm += `    ${id}["${escape(label)}"]\n`;
  });

  const edgeSet = new Set<string>();
  pages.forEach((p: any) => {
    const fromId = pm[p.url];
    if (!fromId) return;
    (p.elements?.links || []).forEach((link: any) => {
      const toId = pm[link.href];
      if (toId && fromId !== toId) {
        const key = `${fromId}-${toId}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          const label = link.text ? `|${escape(link.text)}|` : '';
          mm += `    ${fromId} -->${label} ${toId}\n`;
        }
      }
    });
  });

  const path = `${outDir}/screen-flow.mmd`;
  await writeFile(path, mm, 'utf-8');
  return path;
}

function escape(s: string): string {
  return s.replace(/"/g, "'").replace(/[<>]/g, '').slice(0, 40);
}
