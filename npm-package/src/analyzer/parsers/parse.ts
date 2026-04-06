import { parse as babelParse } from '@babel/parser';
import type { File } from '@babel/types';

/** 소스코드를 AST로 파싱 (TS/TSX/JS/JSX 지원) */
export function parseSource(source: string, ext: string): File {
  const isTS = ext === '.ts' || ext === '.tsx';
  const isJSX = ext === '.tsx' || ext === '.jsx';

  return babelParse(source, {
    sourceType: 'module',
    plugins: [
      ...(isTS ? ['typescript' as const] : []),
      ...(isJSX || isTS ? ['jsx' as const] : []),
      'decorators-legacy' as const,
      'classProperties' as const,
      'optionalChaining' as const,
      'nullishCoalescingOperator' as const,
      'dynamicImport' as const,
    ],
    errorRecovery: true,
  });
}

/** Vue SFC에서 <script> 블록 추출 후 파싱 */
export function parseVue(source: string): File {
  const scriptMatch = source.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  const scriptContent = scriptMatch?.[1] || '';
  const isTS = source.includes('lang="ts"') || source.includes("lang='ts'");

  return parseSource(scriptContent, isTS ? '.ts' : '.js');
}
