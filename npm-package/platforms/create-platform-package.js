/**
 * 플랫폼별 npm 패키지 package.json 자동 생성
 * Usage: node create-platform-package.js
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const VERSION = '0.1.0';

const platforms = [
  { name: 'win32-x64',    os: ['win32'],  cpu: ['x64'],   bin: 'reverseng.exe' },
  { name: 'win32-arm64',  os: ['win32'],  cpu: ['arm64'], bin: 'reverseng.exe' },
  { name: 'linux-x64',    os: ['linux'],  cpu: ['x64'],   bin: 'reverseng' },
  { name: 'linux-arm64',  os: ['linux'],  cpu: ['arm64'], bin: 'reverseng' },
  { name: 'darwin-x64',   os: ['darwin'], cpu: ['x64'],   bin: 'reverseng' },
  { name: 'darwin-arm64', os: ['darwin'], cpu: ['arm64'], bin: 'reverseng' },
];

for (const platform of platforms) {
  const dir = join(import.meta.dirname, platform.name);
  mkdirSync(join(dir, 'bin'), { recursive: true });

  const pkg = {
    name: `@reverse-engine/${platform.name}`,
    version: VERSION,
    description: `reverse-engine native binary for ${platform.name}`,
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'https://github.com/injaehwang/revers-eng',
    },
    os: platform.os,
    cpu: platform.cpu,
    main: `bin/${platform.bin}`,
    files: ['bin'],
  };

  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  console.log(`Created: ${platform.name}/package.json`);
}
