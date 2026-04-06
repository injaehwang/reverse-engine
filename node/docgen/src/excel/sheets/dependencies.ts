import type ExcelJS from 'exceljs';

export function generateDependenciesSheet(
  workbook: ExcelJS.Workbook,
  data: any,
  headerStyle: Partial<ExcelJS.Style>,
): void {
  const sheet = workbook.addWorksheet('의존성 패키지', {
    properties: { tabColor: { argb: 'FF00B0F0' } },
  });

  sheet.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: '패키지명', key: 'name', width: 30 },
    { header: '현재 버전', key: 'currentVersion', width: 15 },
    { header: '최신 버전', key: 'latestVersion', width: 15 },
    { header: '타입', key: 'depType', width: 12 },
    { header: '취약점', key: 'vulnerabilities', width: 25 },
    { header: '라이선스', key: 'license', width: 15 },
  ];

  sheet.getRow(1).eachCell((cell) => {
    Object.assign(cell, { style: headerStyle });
  });

  const deps = data.dependencies || [];
  deps.forEach((dep: any, index: number) => {
    const vulns = dep.vulnerabilities || [];
    sheet.addRow({
      no: index + 1,
      name: dep.name,
      currentVersion: dep.currentVersion || dep.current_version,
      latestVersion: dep.latestVersion || dep.latest_version || '-',
      depType: dep.depType || dep.dep_type || '-',
      vulnerabilities: vulns.length > 0
        ? vulns.map((v: any) => `${v.severity}: ${v.title}`).join('; ')
        : '없음',
      license: dep.license || '-',
    });

    // 취약점이 있는 행은 빨간 배경
    if (vulns.length > 0) {
      const row = sheet.lastRow!;
      row.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFF2CC' },
        };
      });
    }
  });
}
