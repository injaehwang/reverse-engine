/**
 * Excel 워크북 생성 - 6개 시트 자동 생성
 */

import ExcelJS from 'exceljs';
import { mkdir } from 'fs/promises';
import { generatePagesSheet } from './sheets/pages.js';
import { generateApiMapSheet } from './sheets/api-map.js';
import { generateFlowSheet } from './sheets/flow.js';
import { generateComponentsSheet } from './sheets/components.js';
import { generateFunctionsSheet } from './sheets/functions.js';
import { generateDependenciesSheet } from './sheets/dependencies.js';

export async function generateExcel(data: any, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ReversEngine';
  workbook.created = new Date();

  // 공통 스타일
  const headerStyle: Partial<ExcelJS.Style> = {
    font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B579A' } },
    alignment: { horizontal: 'center', vertical: 'middle' },
    border: {
      top: { style: 'thin' },
      bottom: { style: 'thin' },
      left: { style: 'thin' },
      right: { style: 'thin' },
    },
  };

  // Sheet 1: 화면 목록
  generatePagesSheet(workbook, data, headerStyle);

  // Sheet 2: URL-API 매핑
  generateApiMapSheet(workbook, data, headerStyle);

  // Sheet 3: 화면 흐름
  generateFlowSheet(workbook, data, headerStyle);

  // Sheet 4: 컴포넌트 목록
  generateComponentsSheet(workbook, data, headerStyle);

  // Sheet 5: 함수 호출 체인
  generateFunctionsSheet(workbook, data, headerStyle);

  // Sheet 6: 의존성 패키지
  generateDependenciesSheet(workbook, data, headerStyle);

  const filePath = `${outputDir}/reverseng-report.xlsx`;
  await workbook.xlsx.writeFile(filePath);

  return filePath;
}
