/**
 * 플랫폼에 맞는 네이티브 Rust 바이너리를 찾아 반환
 * 없으면 null → JS fallback 사용
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, type ExecFileSyncOptions } from 'child_process';

const PLATFORMS: Record<string, string> = {
  'win32-x64':    'reverse-engine-win32-x64',
  'win32-arm64':  'reverse-engine-win32-arm64',
  'linux-x64':    'reverse-engine-linux-x64',
  'linux-arm64':  'reverse-engine-linux-arm64',
  'darwin-x64':   'reverse-engine-darwin-x64',
  'darwin-arm64': 'reverse-engine-darwin-arm64',
};

/** 네이티브 바이너리 경로를 찾는다 */
export function findNativeBinary(): string | null {
  const key = `${process.platform}-${process.arch}`;
  const pkgName = PLATFORMS[key];
  if (!pkgName) return null;

  try {
    // optionalDependencies에서 설치된 패키지 경로
    const pkgJson = require.resolve(`${pkgName}/package.json`);
    const pkgDir = dirname(pkgJson);
    const pkg = JSON.parse(require('fs').readFileSync(pkgJson, 'utf-8'));
    const binPath = join(pkgDir, pkg.main || (process.platform === 'win32' ? 'bin/reverseng.exe' : 'bin/reverseng'));

    if (existsSync(binPath)) {
      return binPath;
    }
  } catch {
    // 패키지가 설치되지 않음 → fallback
  }

  return null;
}

/** 네이티브 바이너리로 명령어 실행 */
export function execNative(args: string[], options?: ExecFileSyncOptions): string {
  const binPath = findNativeBinary();
  if (!binPath) {
    throw new Error('네이티브 바이너리를 찾을 수 없습니다');
  }

  return execFileSync(binPath, args, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'inherit'],
    ...options,
  }) as string;
}

/** 네이티브 바이너리 사용 가능 여부 */
export function hasNativeBinary(): boolean {
  return findNativeBinary() !== null;
}
