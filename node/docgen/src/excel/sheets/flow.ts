import type ExcelJS from 'exceljs';

export function generateFlowSheet(
  workbook: ExcelJS.Workbook,
  data: any,
  headerStyle: Partial<ExcelJS.Style>,
): void {
  const sheet = workbook.addWorksheet('화면 흐름', {
    properties: { tabColor: { argb: 'FFFFC000' } },
  });

  sheet.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: '출발 화면', key: 'fromUrl', width: 35 },
    { header: '트리거 요소', key: 'trigger', width: 25 },
    { header: '트리거 텍스트', key: 'triggerText', width: 20 },
    { header: '도착 화면', key: 'toUrl', width: 35 },
    { header: '조건', key: 'condition', width: 20 },
  ];

  sheet.getRow(1).eachCell((cell) => {
    Object.assign(cell, { style: headerStyle });
  });

  let rowNum = 0;
  const pages = data.pages || [];
  for (const page of pages) {
    // 링크 기반 흐름
    for (const link of page.elements?.links || []) {
      rowNum++;
      sheet.addRow({
        no: rowNum,
        fromUrl: page.url,
        trigger: link.selector,
        triggerText: link.text,
        toUrl: link.href,
        condition: '-',
      });
    }

    // 버튼 기반 흐름
    for (const btn of page.elements?.buttons || []) {
      if (btn.navigatesTo) {
        rowNum++;
        sheet.addRow({
          no: rowNum,
          fromUrl: page.url,
          trigger: btn.selector,
          triggerText: btn.text,
          toUrl: btn.navigatesTo,
          condition: '-',
        });
      }
    }
  }
}
