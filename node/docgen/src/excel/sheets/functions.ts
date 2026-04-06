import type ExcelJS from 'exceljs';

export function generateFunctionsSheet(
  workbook: ExcelJS.Workbook,
  data: any,
  headerStyle: Partial<ExcelJS.Style>,
): void {
  const sheet = workbook.addWorksheet('함수 호출 체인', {
    properties: { tabColor: { argb: 'FFFF0000' } },
  });

  sheet.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: '함수명', key: 'name', width: 25 },
    { header: '파일', key: 'filePath', width: 40 },
    { header: 'Async', key: 'isAsync', width: 8 },
    { header: 'Exported', key: 'isExported', width: 10 },
    { header: '매개변수', key: 'params', width: 25 },
    { header: '호출하는 함수', key: 'calls', width: 30 },
    { header: '호출되는 곳', key: 'calledBy', width: 30 },
  ];

  sheet.getRow(1).eachCell((cell) => {
    Object.assign(cell, { style: headerStyle });
  });

  const functions = data.functions || [];
  functions.forEach((func: any, index: number) => {
    sheet.addRow({
      no: index + 1,
      name: func.name,
      filePath: func.filePath || func.file_path,
      isAsync: func.isAsync || func.is_async ? 'Y' : 'N',
      isExported: func.isExported || func.is_exported ? 'Y' : 'N',
      params: (func.params || []).join(', '),
      calls: (func.calls || []).join(', '),
      calledBy: (func.calledBy || func.called_by || []).join(', '),
    });
  });
}
