import _traverse from '@babel/traverse';
import type { RouteInfo } from '../../types.js';
import { parseSource, parseVue } from '../parsers/parse.js';

const traverse = (_traverse as any).default || _traverse;

export function extractRoutes(source: string, filePath: string, ext: string): RouteInfo[] {
  // Next.js/Nuxt 파일 기반 라우팅
  if (filePath.includes('pages/') || filePath.includes('app/')) {
    const route = inferFileBasedRoute(filePath);
    if (route) return [route];
  }

  if (ext === '.vue') return []; // Vue Router는 별도 설정 파일에서

  const ast = parseSource(source, ext);
  const routes: RouteInfo[] = [];

  traverse(ast, {
    // <Route path="..." element={<Comp />} />
    JSXOpeningElement(path: any) {
      const name = path.node.name;
      if (name?.type !== 'JSXIdentifier' || name.name !== 'Route') return;

      let routePath = '';
      let component = '';

      for (const attr of path.node.attributes || []) {
        if (attr.type !== 'JSXAttribute') continue;
        const attrName = attr.name?.name;

        if (attrName === 'path' && attr.value?.type === 'StringLiteral') {
          routePath = attr.value.value;
        }
        if ((attrName === 'element' || attrName === 'component') && attr.value?.type === 'JSXExpressionContainer') {
          const expr = attr.value.expression;
          if (expr.type === 'JSXElement') {
            component = expr.openingElement?.name?.name || '';
          } else if (expr.type === 'Identifier') {
            component = expr.name;
          }
        }
      }

      if (routePath) {
        routes.push({
          path: routePath,
          component: component || '?',
          filePath,
          guards: [],
        });
      }
    },

    // Vue Router / generic: { path: '...', component: ... }
    ObjectExpression(path: any) {
      let routePath = '';
      let component = '';

      for (const prop of path.node.properties || []) {
        if (prop.type !== 'ObjectProperty') continue;
        const key = prop.key?.name || prop.key?.value;

        if (key === 'path' && prop.value?.type === 'StringLiteral') {
          routePath = prop.value.value;
        }
        if (key === 'component' && prop.value?.type === 'Identifier') {
          component = prop.value.name;
        }
      }

      if (routePath.startsWith('/') && component) {
        // 중복 방지
        if (!routes.some(r => r.path === routePath)) {
          routes.push({ path: routePath, component, filePath, guards: [] });
        }
      }
    },
  });

  return routes;
}

function inferFileBasedRoute(filePath: string): RouteInfo | null {
  const normalized = filePath.replace(/\\/g, '/');
  let routePart = '';

  if (normalized.includes('pages/')) {
    routePart = normalized.split('pages/')[1];
  } else if (normalized.includes('app/')) {
    routePart = normalized.split('app/')[1];
  } else {
    return null;
  }

  const routePath = routePart
    .replace(/\.(tsx?|jsx?|vue)$/, '')
    .replace(/\/index$/, '')
    .replace(/\/page$/, '')
    .replace(/\[(\w+)\]/g, ':$1');

  const component = filePath.split('/').pop()?.split('.')[0] || '';

  return {
    path: routePath ? `/${routePath}` : '/',
    component,
    filePath,
    guards: [],
  };
}
