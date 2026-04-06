import _traverse from '@babel/traverse';
import type { ApiClientCall } from '../../types.js';
import { parseSource, parseVue } from '../parsers/parse.js';

const traverse = (_traverse as any).default || _traverse;

export function extractApiCalls(source: string, filePath: string, ext: string): ApiClientCall[] {
  const ast = ext === '.vue' ? parseVue(source) : parseSource(source, ext);
  const calls: ApiClientCall[] = [];

  traverse(ast, {
    CallExpression(path: any) {
      const callee = path.node.callee;
      let funcText = '';
      let method = '';

      // fetch('url')
      if (callee?.type === 'Identifier' && callee.name === 'fetch') {
        funcText = 'fetch';
        method = 'GET';
        // 두 번째 인자에서 method 확인
        const opts = path.node.arguments[1];
        if (opts?.type === 'ObjectExpression') {
          for (const prop of opts.properties) {
            if (prop.key?.name === 'method' && prop.value?.type === 'StringLiteral') {
              method = prop.value.value.toUpperCase();
            }
          }
        }
      }

      // axios.get/post/put/delete, api.get, $http.get, requests.get
      if (callee?.type === 'MemberExpression') {
        const obj = callee.object?.name || '';
        const prop = callee.property?.name || '';

        if (['axios', 'api', '$http', 'http', 'requests', 'this'].includes(obj) ||
            obj.endsWith('Client') || obj.endsWith('Api')) {
          const methodMap: Record<string, string> = {
            get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE',
            patch: 'PATCH', head: 'HEAD', options: 'OPTIONS',
          };
          if (methodMap[prop]) {
            funcText = `${obj}.${prop}`;
            method = methodMap[prop];
          }
        }
      }

      if (!funcText || !method) return;

      // URL 추출
      const firstArg = path.node.arguments[0];
      let url = '';
      if (firstArg?.type === 'StringLiteral') {
        url = firstArg.value;
      } else if (firstArg?.type === 'TemplateLiteral' && firstArg.quasis?.[0]) {
        url = firstArg.quasis.map((q: any) => q.value.raw).join('*');
      }

      if (!url) return;

      // 상위 함수명 찾기
      const functionName = findEnclosingFunctionName(path);

      calls.push({
        method,
        urlPattern: url,
        filePath,
        line: path.node.loc?.start.line || 0,
        functionName,
      });
    },
  });

  return calls;
}

function findEnclosingFunctionName(path: any): string {
  let current = path.parentPath;
  while (current) {
    if (current.node.type === 'FunctionDeclaration' && current.node.id) {
      return current.node.id.name;
    }
    if (current.node.type === 'VariableDeclarator' && current.node.id?.name) {
      const init = current.node.init;
      if (init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression') {
        return current.node.id.name;
      }
    }
    if (current.node.type === 'ClassMethod' && current.node.key?.name) {
      return current.node.key.name;
    }
    current = current.parentPath;
  }
  return '<anonymous>';
}
