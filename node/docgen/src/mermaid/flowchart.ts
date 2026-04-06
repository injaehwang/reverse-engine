/**
 * Mermaid 플로우차트 자동 생성
 */

import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

export async function generateMermaid(data: any, outputDir: string): Promise<string> {
  const pages = data.pages || [];
  const lines: string[] = ['graph TD'];

  // 노드 정의
  const nodeIds = new Map<string, string>();
  pages.forEach((page: any, i: number) => {
    const id = `P${i}`;
    const label = page.title || page.url;
    nodeIds.set(page.url, id);
    lines.push(`    ${id}["${escapeLabel(label)}<br/><small>${escapeLabel(page.url)}</small>"]`);
  });

  // 엣지 (네비게이션)
  for (const page of pages) {
    const fromId = nodeIds.get(page.url);
    if (!fromId) continue;

    for (const link of page.elements?.links || []) {
      const toId = nodeIds.get(link.href);
      if (toId && fromId !== toId) {
        const label = link.text ? `|${escapeLabel(link.text)}|` : '';
        lines.push(`    ${fromId} -->${label} ${toId}`);
      }
    }
  }

  // 스타일
  lines.push('');
  lines.push('    classDef page fill:#2B579A,stroke:#1a3a6a,color:#fff');
  lines.push('    classDef api fill:#00B050,stroke:#007030,color:#fff');
  const allIds = [...nodeIds.values()].join(',');
  if (allIds) {
    lines.push(`    class ${allIds} page`);
  }

  const mermaidCode = lines.join('\n');
  const filePath = `${outputDir}/flow.mmd`;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, mermaidCode, 'utf-8');

  return filePath;
}

function escapeLabel(str: string): string {
  return str
    .replace(/"/g, "'")
    .replace(/[<>]/g, '')
    .slice(0, 50);
}
