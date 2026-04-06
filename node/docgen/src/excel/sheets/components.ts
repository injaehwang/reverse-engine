import type ExcelJS from 'exceljs';

export function generateComponentsSheet(
  workbook: ExcelJS.Workbook,
  data: any,
  headerStyle: Partial<ExcelJS.Style>,
): void {
  const sheet = workbook.addWorksheet('컴포넌트 목록', {
    properties: { tabColor: { argb: 'FF7030A0' } },
  });

  sheet.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: '컴포넌트명', key: 'name', width: 25 },
    { header: '파일 경로', key: 'filePath', width: 45 },
    { header: '타입', key: 'type', width: 12 },
    { header: 'Props', key: 'props', width: 30 },
    { header: '사용처', key: 'usedBy', width: 30 },
    { header: '하위 컴포넌트', key: 'children', width: 30 },
    { header: 'Hooks', key: 'hooks', width: 25 },
  ];

  sheet.getRow(1).eachCell((cell) => {
    Object.assign(cell, { style: headerStyle });
  });

  const components = data.components || [];
  components.forEach((comp: any, index: number) => {
    sheet.addRow({
      no: index + 1,
      name: comp.name,
      filePath: comp.filePath || comp.file_path,
      type: comp.componentType || comp.component_type || '-',
      props: (comp.props || []).map((p: any) => p.name || p).join(', '),
      usedBy: (comp.usedBy || comp.used_by || []).join(', '),
      children: (comp.children || []).join(', '),
      hooks: (comp.hooks || []).join(', '),
    });
  });
}
