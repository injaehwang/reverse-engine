import _traverse from '@babel/traverse';
import type { ComponentInfo } from '../../types.js';
import { parseSource, parseVue } from '../parsers/parse.js';

const traverse = (_traverse as any).default || _traverse;

export function extractComponents(source: string, filePath: string, ext: string): ComponentInfo[] {
  const ast = ext === '.vue' ? parseVue(source) : parseSource(source, ext);
  const components: ComponentInfo[] = [];

  if (ext === '.vue') {
    // Vue SFC = 파일 자체가 컴포넌트
    const name = filePath.split('/').pop()?.replace('.vue', '') || filePath;
    const hooks = collectHooks(ast);
    const apiCalls = collectApiPatterns(ast);

    components.push({
      name,
      filePath,
      lineStart: 1,
      lineEnd: source.split('\n').length,
      componentType: inferType(filePath),
      props: [],
      children: [],
      usedBy: [],
      hooks,
      apiCalls,
    });
    return components;
  }

  // React 컴포넌트 추출 (대문자 시작 + JSX 반환)
  traverse(ast, {
    FunctionDeclaration(path: any) {
      const comp = tryExtractReactComponent(path, filePath, source);
      if (comp) components.push(comp);
    },
    VariableDeclarator(path: any) {
      const init = path.node.init;
      if (!init || (init.type !== 'ArrowFunctionExpression' && init.type !== 'FunctionExpression')) return;
      if (path.node.id?.type !== 'Identifier') return;

      const name = path.node.id.name;
      if (!name[0] || name[0] !== name[0].toUpperCase()) return;
      if (!hasJSX(path)) return;

      const children = collectJSXChildren(path);
      const hooks = collectHooks(path.get('init'));
      const apiCalls = collectApiPatterns(path.get('init'));

      components.push({
        name,
        filePath,
        lineStart: path.node.loc?.start.line || 0,
        lineEnd: path.node.loc?.end.line || 0,
        componentType: inferType(filePath),
        props: extractProps(init),
        children,
        usedBy: [],
        hooks,
        apiCalls,
      });
    },
  });

  return components;
}

function tryExtractReactComponent(path: any, filePath: string, source: string): ComponentInfo | null {
  const name = path.node.id?.name;
  if (!name || name[0] !== name[0].toUpperCase()) return null;
  if (!hasJSX(path)) return null;

  return {
    name,
    filePath,
    lineStart: path.node.loc?.start.line || 0,
    lineEnd: path.node.loc?.end.line || 0,
    componentType: inferType(filePath),
    props: extractProps(path.node),
    children: collectJSXChildren(path),
    usedBy: [],
    hooks: collectHooks(path),
    apiCalls: collectApiPatterns(path),
  };
}

function hasJSX(path: any): boolean {
  let found = false;
  path.traverse({
    JSXElement() { found = true; },
    JSXFragment() { found = true; },
  });
  return found;
}

function collectJSXChildren(path: any): string[] {
  const children = new Set<string>();
  path.traverse({
    JSXOpeningElement(jsxPath: any) {
      const name = jsxPath.node.name;
      let tagName = '';
      if (name.type === 'JSXIdentifier') tagName = name.name;
      else if (name.type === 'JSXMemberExpression') tagName = name.property?.name || '';

      if (tagName && tagName[0] === tagName[0].toUpperCase()) {
        children.add(tagName);
      }
    },
  });
  return [...children].sort();
}

function collectHooks(pathOrAst: any): string[] {
  const hooks = new Set<string>();
  const visitor = {
    CallExpression(callPath: any) {
      const name = callPath.node.callee?.name;
      if (name?.startsWith('use')) hooks.add(name);
    },
  };

  if (pathOrAst.traverse) {
    pathOrAst.traverse(visitor);
  } else {
    traverse(pathOrAst, visitor);
  }
  return [...hooks].sort();
}

function collectApiPatterns(pathOrAst: any): string[] {
  const apis = new Set<string>();
  const visitor = {
    CallExpression(callPath: any) {
      const callee = callPath.node.callee;
      let funcText = '';

      if (callee?.type === 'MemberExpression') {
        const obj = callee.object?.name || '';
        const prop = callee.property?.name || '';
        funcText = `${obj}.${prop}`;
      } else if (callee?.type === 'Identifier') {
        funcText = callee.name;
      }

      if (funcText === 'fetch' || funcText.startsWith('axios.') || funcText.startsWith('api.') || funcText.startsWith('$http.')) {
        const args = callPath.node.arguments;
        const method = funcText.includes('.get') ? 'GET'
          : funcText.includes('.post') ? 'POST'
          : funcText.includes('.put') ? 'PUT'
          : funcText.includes('.delete') ? 'DELETE'
          : funcText === 'fetch' ? 'GET' : 'GET';

        let url = '';
        if (args[0]?.type === 'StringLiteral') url = args[0].value;
        else if (args[0]?.type === 'TemplateLiteral' && args[0].quasis?.[0]) {
          url = args[0].quasis[0].value.raw;
        }

        if (url) apis.add(`${method} ${url}`);
      }
    },
  };

  if (pathOrAst.traverse) {
    pathOrAst.traverse(visitor);
  } else {
    traverse(pathOrAst, visitor);
  }
  return [...apis].sort();
}

function extractProps(node: any): { name: string; type: string; required: boolean }[] {
  const params = node.params || [];
  if (params.length === 0) return [];

  const first = params[0];
  if (first.type === 'ObjectPattern') {
    return first.properties
      .filter((p: any) => p.type === 'ObjectProperty' || p.type === 'Property')
      .map((p: any) => ({
        name: p.key?.name || '?',
        type: 'unknown',
        required: true,
      }));
  }
  return [];
}

function inferType(filePath: string): ComponentInfo['componentType'] {
  const p = filePath.toLowerCase();
  if (p.includes('page') || p.includes('views') || p.includes('routes')) return 'Page';
  if (p.includes('layout')) return 'Layout';
  if (p.includes('util') || p.includes('helper') || p.includes('hoc')) return 'Utility';
  return 'Widget';
}
