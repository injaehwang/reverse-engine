/**
 * ReversEngine TestGen - 테스트 코드 자동 생성기
 */

import { generateE2ETests } from './generators/e2e.js';
import { generateApiTests } from './generators/api.js';
import { generateFlowTests } from './generators/flow.js';

interface IpcRequest {
  command: string;
  payload: {
    input: string;
    types: string[];
    outputDir: string;
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

    const { readFile } = await import('fs/promises');
    const analysisData = JSON.parse(await readFile(payload.input, 'utf-8'));

    const generatedFiles: string[] = [];

    for (const type of payload.types) {
      switch (type.trim()) {
        case 'e2e': {
          const files = await generateE2ETests(analysisData, payload.outputDir);
          generatedFiles.push(...files);
          break;
        }
        case 'api': {
          const files = await generateApiTests(analysisData, payload.outputDir);
          generatedFiles.push(...files);
          break;
        }
        case 'flow': {
          const files = await generateFlowTests(analysisData, payload.outputDir);
          generatedFiles.push(...files);
          break;
        }
      }
    }

    response = { success: true, data: { files: generatedFiles } };
  } catch (error) {
    response = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  process.stdout.write(JSON.stringify(response));
}

main().catch(console.error);
