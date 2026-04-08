/**
 * ReversEngine DocGen - Excel/HTML/Markdown 문서 생성기
 *
 * Rust CLI에서 subprocess로 호출되며 stdin/stdout JSON으로 통신
 */

import { generateExcel } from './excel/workbook.js';
import { generateMermaid } from './mermaid/flowchart.js';
import { generateMarkdown } from './markdown/generator.js';

interface IpcRequest {
  command: string;
  payload: {
    input: string;
    formats: string[];
  };
}

interface IpcResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks).toString('utf-8');

  let response: IpcResponse;

  try {
    const request: IpcRequest = JSON.parse(input);
    const { payload } = request;

    // 분석 결과 로드
    const { readFile } = await import('fs/promises');
    const analysisData = JSON.parse(await readFile(payload.input, 'utf-8'));

    const outputs: string[] = [];

    for (const format of payload.formats) {
      switch (format.trim()) {
        case 'excel': {
          const path = await generateExcel(analysisData, 'output/reports');
          outputs.push(path);
          break;
        }
        case 'mermaid': {
          const path = await generateMermaid(analysisData, 'output/reports');
          outputs.push(path);
          break;
        }
        case 'markdown': {
          const mdPath = await generateMarkdown(analysisData, 'output/reports');
          outputs.push(mdPath);
          break;
        }
        // TODO: html
      }
    }

    response = { success: true, data: { outputs } };
  } catch (error) {
    response = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  process.stdout.write(JSON.stringify(response));
}

main().catch(console.error);
