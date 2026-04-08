/**
 * 그래프 시각화 - Mermaid + DOT(Graphviz) 자동 생성
 *
 * 소규모 (< 50 노드): Mermaid flowchart
 * 대규모 (50+ 노드): 클러스터링된 Mermaid + DOT 파일 병행 출력
 */

import { writeFile, mkdir } from 'fs/promises';
import path from 'node:path';

const MERMAID_NODE_LIMIT = 50;

export async function generateMermaid(data: any, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const components = data.components || [];

  // 항상 Mermaid 출력
  const mermaidPath = path.join(outputDir, 'component-graph.mmd');
  if (components.length <= MERMAID_NODE_LIMIT) {
    await writeFile(mermaidPath, generateFullMermaid(data), 'utf-8');
  } else {
    await writeFile(mermaidPath, generateClusteredMermaid(data), 'utf-8');
    // 대규모: DOT 파일도 병행 출력
    const dotPath = path.join(outputDir, 'component-graph.dot');
    await writeFile(dotPath, generateDot(data), 'utf-8');
  }

  return mermaidPath;
}

/** 소규모 그래프: 전체 노드 Mermaid */
function generateFullMermaid(data: any): string {
  const components = data.components || [];
  const routes = data.routes || [];
  const cm: Record<string, string> = {};

  const lines = ['graph TD'];

  components.forEach((c: any, i: number) => {
    cm[c.name] = `C${i}`;
    lines.push(`    C${i}["${esc(c.name)}"]`);
  });

  components.forEach((c: any, i: number) => {
    for (const ch of c.children || []) {
      if (cm[ch]) lines.push(`    C${i} --> ${cm[ch]}`);
    }
  });

  routes.forEach((r: any, i: number) => {
    const comp = r.component.replace(/[<>/\s]/g, '').trim();
    if (cm[comp]) lines.push(`    R${i}("${esc(r.path)}") -.-> ${cm[comp]}`);
  });

  lines.push('');
  addMermaidStyles(lines, components, cm);

  return lines.join('\n');
}

/** 대규모 그래프: 디렉토리별 클러스터링 + 중요 노드만 표시 */
function generateClusteredMermaid(data: any): string {
  const components: any[] = data.components || [];
  const routes: any[] = data.routes || [];

  // 디렉토리별 그룹핑
  const groups = new Map<string, any[]>();
  for (const c of components) {
    const dir = c.file_path.replace(/\\/g, '/').split('/').slice(0, -1).join('/') || 'root';
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(c);
  }

  const cm: Record<string, string> = {};
  const lines = ['graph TD'];

  // 중요도 점수: children 수 + used_by 수 + hooks 수 + api_calls 수
  const scored = components.map((c) => ({
    ...c,
    score:
      (c.children?.length || 0) +
      (c.used_by?.length || 0) * 2 +
      (c.hooks?.length || 0) +
      (c.api_calls?.length || 0) * 2,
  }));

  // 상위 50개 + 모든 Page 타입
  const topN = new Set<string>();
  scored
    .filter((c) => c.component_type === 'Page')
    .forEach((c) => topN.add(c.name));
  scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MERMAID_NODE_LIMIT)
    .forEach((c) => topN.add(c.name));

  // 클러스터별 subgraph
  let nodeIdx = 0;
  for (const [dir, comps] of groups) {
    const visible = comps.filter((c: any) => topN.has(c.name));
    const hidden = comps.length - visible.length;

    if (visible.length === 0) continue;

    const dirLabel = dir.replace(/src\/?/, '').replace(/\//g, ' / ') || 'root';
    lines.push(`    subgraph ${sanitizeId(dir)}["${esc(dirLabel)}"]`);

    for (const c of visible) {
      const id = `C${nodeIdx++}`;
      cm[c.name] = id;
      lines.push(`        ${id}["${esc(c.name)}"]`);
    }

    if (hidden > 0) {
      lines.push(`        ${sanitizeId(dir)}_more["... +${hidden}개"]`);
    }

    lines.push('    end');
  }

  // 엣지 (표시된 노드 간만)
  for (const c of components) {
    if (!cm[c.name]) continue;
    for (const ch of c.children || []) {
      if (cm[ch]) lines.push(`    ${cm[c.name]} --> ${cm[ch]}`);
    }
  }

  // 라우트
  routes.forEach((r: any, i: number) => {
    const comp = r.component.replace(/[<>/\s]/g, '').trim();
    if (cm[comp]) lines.push(`    R${i}("${esc(r.path)}") -.-> ${cm[comp]}`);
  });

  lines.push('');
  lines.push(`    %% 전체 ${components.length}개 컴포넌트 중 ${topN.size}개 표시`);
  addMermaidStyles(lines, components.filter((c) => cm[c.name]), cm);

  return lines.join('\n');
}

/** DOT(Graphviz) 형식 출력 — 100+ 노드도 처리 가능 */
function generateDot(data: any): string {
  const components: any[] = data.components || [];
  const routes: any[] = data.routes || [];

  const lines = [
    'digraph ReversEngine {',
    '    rankdir=TB;',
    '    node [shape=box, style="rounded,filled", fontname="sans-serif", fontsize=10];',
    '    edge [fontsize=8];',
    '',
  ];

  // 디렉토리별 subgraph (cluster)
  const groups = new Map<string, any[]>();
  for (const c of components) {
    const dir = c.file_path.replace(/\\/g, '/').split('/').slice(0, -1).join('/') || 'root';
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(c);
  }

  let clusterIdx = 0;
  for (const [dir, comps] of groups) {
    lines.push(`    subgraph cluster_${clusterIdx++} {`);
    lines.push(`        label="${esc(dir)}";`);
    lines.push(`        style=dashed;`);
    lines.push(`        color="#cccccc";`);

    for (const c of comps) {
      const color =
        c.component_type === 'Page' ? '#e74c3c' :
        c.component_type === 'Layout' ? '#2ecc71' : '#3498db';
      lines.push(`        "${esc(c.name)}" [fillcolor="${color}", fontcolor="white"];`);
    }

    lines.push('    }');
  }

  // 엣지
  for (const c of components) {
    for (const ch of c.children || []) {
      if (components.some((x: any) => x.name === ch)) {
        lines.push(`    "${esc(c.name)}" -> "${esc(ch)}";`);
      }
    }
  }

  // 라우트
  for (const r of routes) {
    const comp = r.component.replace(/[<>/\s]/g, '').trim();
    if (components.some((c: any) => c.name === comp)) {
      lines.push(`    "${esc(r.path)}" -> "${esc(comp)}" [style=dashed, color="#999999"];`);
      lines.push(`    "${esc(r.path)}" [shape=ellipse, fillcolor="#f39c12", fontcolor="white"];`);
    }
  }

  lines.push('}');
  return lines.join('\n');
}

function addMermaidStyles(lines: string[], components: any[], cm: Record<string, string>): void {
  lines.push('    classDef page fill:#e74c3c,color:#fff');
  lines.push('    classDef widget fill:#3498db,color:#fff');
  lines.push('    classDef layout fill:#2ecc71,color:#fff');
  for (const c of components) {
    const id = cm[c.name];
    if (!id) continue;
    if (c.component_type === 'Page') lines.push(`    class ${id} page`);
    else if (c.component_type === 'Layout') lines.push(`    class ${id} layout`);
    else lines.push(`    class ${id} widget`);
  }
}

function esc(s: string): string {
  return s.replace(/"/g, "'").replace(/[<>]/g, '').slice(0, 60);
}

function sanitizeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, '_');
}
