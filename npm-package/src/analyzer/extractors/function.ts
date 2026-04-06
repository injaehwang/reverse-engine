import _traverse from '@babel/traverse';
import type { FunctionInfo } from '../../types.js';
import { parseSource, parseVue } from '../parsers/parse.js';

// ESM 호환
const traverse = (_traverse as any).default || _traverse;

export function extractFunctions(source: string, filePath: string, ext: string): FunctionInfo[] {
  const ast = ext === '.vue' ? parseVue(source) : parseSource(source, ext);
  const functions: FunctionInfo[] = [];

  traverse(ast, {
    // function foo() {} / async function foo() {}
    FunctionDeclaration(path: any) {
      if (!path.node.id) return;
      functions.push(buildFunctionInfo(path, filePath));
    },

    // const foo = () => {} / const foo = function() {}
    VariableDeclarator(path: any) {
      const init = path.node.init;
      if (!init) return;
      if (init.type !== 'ArrowFunctionExpression' && init.type !== 'FunctionExpression') return;
      if (path.node.id?.type !== 'Identifier') return;

      const name = path.node.id.name;
      const calls = collectCallExpressions(path);
      const isExported = path.parentPath?.parentPath?.node.type === 'ExportNamedDeclaration'
        || path.parentPath?.parentPath?.node.type === 'ExportDefaultDeclaration';

      functions.push({
        name,
        filePath,
        lineStart: path.node.loc?.start.line || 0,
        lineEnd: path.node.loc?.end.line || 0,
        params: extractParams(init),
        returnType: init.returnType?.typeAnnotation?.type,
        calls,
        calledBy: [],
        isAsync: init.async || false,
        isExported,
      });
    },

    // class methods
    ClassMethod(path: any) {
      const name = path.node.key?.name;
      if (!name) return;
      functions.push({
        name,
        filePath,
        lineStart: path.node.loc?.start.line || 0,
        lineEnd: path.node.loc?.end.line || 0,
        params: extractParams(path.node),
        returnType: undefined,
        calls: collectCallExpressions(path),
        calledBy: [],
        isAsync: path.node.async || false,
        isExported: false,
      });
    },
  });

  return functions;
}

function buildFunctionInfo(path: any, filePath: string): FunctionInfo {
  const node = path.node;
  const isExported = path.parentPath?.node.type === 'ExportNamedDeclaration'
    || path.parentPath?.node.type === 'ExportDefaultDeclaration';

  return {
    name: node.id.name,
    filePath,
    lineStart: node.loc?.start.line || 0,
    lineEnd: node.loc?.end.line || 0,
    params: extractParams(node),
    returnType: node.returnType?.typeAnnotation?.type,
    calls: collectCallExpressions(path),
    calledBy: [],
    isAsync: node.async || false,
    isExported,
  };
}

function extractParams(node: any): string[] {
  return (node.params || []).map((p: any) => {
    if (p.type === 'Identifier') return p.name;
    if (p.type === 'AssignmentPattern' && p.left?.name) return p.left.name;
    if (p.type === 'ObjectPattern') return '{...}';
    if (p.type === 'RestElement') return `...${p.argument?.name || ''}`;
    return '?';
  });
}

function collectCallExpressions(path: any): string[] {
  const calls = new Set<string>();

  path.traverse({
    CallExpression(callPath: any) {
      const callee = callPath.node.callee;
      let name = '';

      if (callee.type === 'Identifier') {
        name = callee.name;
      } else if (callee.type === 'MemberExpression') {
        // a.b.c → c
        name = callee.property?.name || '';
      }

      if (name && name !== 'require') {
        calls.add(name);
      }
    },
  });

  return [...calls].sort();
}
