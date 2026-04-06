# reverse-engine

웹 서비스 역분석 자동화 도구 — 소스코드를 넣으면 **Excel 문서**, **Mermaid 다이어그램**, **테스트 코드**가 자동 생성됩니다.

## 설치

```bash
npm install -g reverse-engine
```

## 사용법

### 전체 파이프라인 (한 줄)

```bash
reverse-engine full --source ./my-project --output ./output
```

이 명령 하나로:
1. 소스코드 분석 (컴포넌트, 함수, API, 라우트, 의존성)
2. Excel 리포트 생성 (5개 시트)
3. Mermaid 컴포넌트 다이어그램 생성
4. E2E + API 테스트 코드 자동 생성

### 개별 명령어

```bash
# 소스코드 분석
reverse-engine analyze ./my-project

# 리포트 생성
reverse-engine report --input output/analysis.json --format excel,mermaid

# 테스트 코드 생성
reverse-engine test --input output/analysis.json --type e2e,api
```

## 지원 프레임워크

- **React** / Next.js
- **Vue** / Nuxt
- **Angular**
- **Svelte**
- TypeScript / JavaScript

## 출력물

### Excel 리포트 (5개 시트)

| 시트 | 내용 |
|------|------|
| 컴포넌트 목록 | 이름, 파일, 타입, Props, 하위 컴포넌트, Hooks |
| API 엔드포인트 | Method, URL, 파일, 함수명, 라인 |
| 라우트 | Path, Component, 파일 |
| 함수 호출 체인 | 함수명, 호출/피호출 관계, async/export 여부 |
| 의존성 패키지 | 패키지명, 버전, prod/dev 구분 |

### Mermaid 다이어그램

컴포넌트 관계 + 라우트 매핑 플로우차트 자동 생성

### 테스트 코드

- **E2E 테스트**: 라우트별 페이지 로드 + 컴포넌트 렌더링
- **API 테스트**: 엔드포인트별 상태코드 검증

## 프로그래매틱 사용

```typescript
import { analyze, generateReport, generateTests } from 'reverse-engine';

const result = await analyze('./my-project');
await generateReport(result, { formats: ['excel', 'mermaid'] });
await generateTests(result, { types: ['e2e', 'api'] });
```

## 분석 결과 예시

```
프레임워크: React
컴포넌트: 7개 (App, Dashboard, Settings, Login, Layout, StatsCard, ActivityFeed)
함수: 16개 (loadData, handleRefresh, handleExport, handleLogin, handleSave...)
API: 7개 (GET /api/dashboard/stats, POST /api/auth/login, PUT /api/settings/profile...)
라우트: 3개 (/, /settings, /login)
의존성: 8개 (react, axios, zustand...)
```

## License

MIT
