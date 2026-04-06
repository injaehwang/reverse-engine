import type ExcelJS from 'exceljs';

export function generatePagesSheet(
  workbook: ExcelJS.Workbook,
  data: any,
  headerStyle: Partial<ExcelJS.Style>,
): void {
  const sheet = workbook.addWorksheet('화면 목록', {
    properties: { tabColor: { argb: 'FF2B579A' } },
  });

  // 컬럼 정의
  sheet.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: 'URL', key: 'url', width: 40 },
    { header: '화면명', key: 'title', width: 25 },
    { header: '스크린샷', key: 'screenshot', width: 15 },
    { header: '설명', key: 'description', width: 40 },
    { header: '인증필요', key: 'authRequired', width: 10 },
    { header: '링크 수', key: 'linkCount', width: 10 },
    { header: '버튼 수', key: 'buttonCount', width: 10 },
    { header: 'API 호출 수', key: 'apiCount', width: 12 },
  ];

  // 헤더 스타일
  sheet.getRow(1).eachCell((cell) => {
    Object.assign(cell, { style: headerStyle });
  });

  // 데이터 행
  const pages = data.pages || [];
  pages.forEach((page: any, index: number) => {
    sheet.addRow({
      no: index + 1,
      url: page.url,
      title: page.title || '',
      screenshot: page.screenshotPath ? '[링크]' : '-',
      description: '',
      authRequired: page.authRequired ? 'Y' : 'N',
      linkCount: page.elements?.links?.length || 0,
      buttonCount: page.elements?.buttons?.length || 0,
      apiCount: page.apiCalls?.length || 0,
    });
  });

  // 자동 필터
  if (pages.length > 0) {
    sheet.autoFilter = { from: 'A1', to: `I${pages.length + 1}` };
  }
}
