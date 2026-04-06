import type ExcelJS from 'exceljs';

export function generateApiMapSheet(
  workbook: ExcelJS.Workbook,
  data: any,
  headerStyle: Partial<ExcelJS.Style>,
): void {
  const sheet = workbook.addWorksheet('URL-API 매핑', {
    properties: { tabColor: { argb: 'FF00B050' } },
  });

  sheet.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: '화면 URL', key: 'pageUrl', width: 35 },
    { header: 'API Endpoint', key: 'apiUrl', width: 40 },
    { header: 'Method', key: 'method', width: 10 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Request Body', key: 'requestBody', width: 30 },
    { header: 'Response 요약', key: 'responseSummary', width: 30 },
    { header: '호출 시점', key: 'trigger', width: 20 },
  ];

  sheet.getRow(1).eachCell((cell) => {
    Object.assign(cell, { style: headerStyle });
  });

  let rowNum = 0;
  const pages = data.pages || [];
  for (const page of pages) {
    for (const api of page.apiCalls || []) {
      rowNum++;
      sheet.addRow({
        no: rowNum,
        pageUrl: page.url,
        apiUrl: api.url,
        method: api.method,
        status: api.responseStatus,
        requestBody: api.requestBody ? JSON.stringify(api.requestBody).slice(0, 100) : '-',
        responseSummary: api.responseBody
          ? Object.keys(api.responseBody).join(', ').slice(0, 100)
          : '-',
        trigger: api.triggeredBy || '페이지 로드',
      });
    }
  }
}
