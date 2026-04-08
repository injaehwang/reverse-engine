# reverse-engine

**역분석 기반 테스트 자동화 도구**

실행 중인 서비스에 접속하여 화면, API, 사용자 흐름을 자동으로 분석하고, 분석 결과를 기반으로 **테스트 코드**, **문서**, **화면 흐름도**를 자동 생성합니다.

> **개발/테스트 환경 전용입니다.** 크롤러가 버튼 클릭, 폼 제출을 자동 수행하므로 실제 데이터가 변경될 수 있습니다.

## 설치

```bash
npm install -g reverse-engine
```

## 사용법

```bash
# 서비스 분석 + 문서 + 테스트 코드 자동 생성
reverse-engine full http://localhost:3000

# 로그인이 필요한 서비스
reverse-engine full http://localhost:3000 \
  --login-url=/login \
  --login-id=admin@test.com \
  --login-pw=password123

# 소스코드도 함께 분석
reverse-engine full http://localhost:3000 --source ./my-project
```

## 이 도구가 하는 일

### 1. 서비스 자동 탐색

Playwright 브라우저로 실제 서비스에 접속하여 사용자처럼 화면을 탐색합니다.

- 네비게이션 메뉴(sidebar, GNB)를 **실제 클릭**하여 화면 전환 추적
- SPA(React, Vue) 메뉴도 대응 (div, li, span + cursor:pointer)
- **폼 자동 입력 + 제출** (input, textarea, select, checkbox)
- 모달, 팝업, 드롭다운 자동 감지
- API 호출 자동 캡처 (XHR/fetch)
- 모든 화면 스크린샷 저장
- DFS 탐색: 메뉴 하나를 끝까지 파고든 후 다음 메뉴로

### 2. 소스코드 정적 분석

프로젝트 소스코드를 AST 기반으로 분석합니다.

- 컴포넌트 트리 (props, hooks, children, 사용처)
- 함수 호출 체인 (누가 누구를 호출하는지)
- API 엔드포인트 추출 (fetch, axios 패턴)
- 라우트 매핑 (React Router, Vue Router, Next.js App Router, Remix)
- 상태 관리 분석 (Redux, Zustand, Pinia, Recoil)
- 의존성 목록

### 3. 산출물 자동 생성

| 산출물 | 설명 |
|--------|------|
| **E2E 테스트 코드** | Playwright 기반 페이지 로드, 네비게이션, 요소 확인 테스트 |
| **API 테스트 코드** | 엔드포인트별 상태 코드, 응답 스키마 검증 테스트 |
| **Excel 리포트** | 화면 목록, API 매핑, 화면 흐름, 컴포넌트, 함수 호출 체인, 의존성 |
| **Mermaid 다이어그램** | 컴포넌트 관계도, 화면 흐름도 |
| **스크린샷** | 전체 화면, 클릭 위치 표시, 폼 입력 결과 |

## 인증 지원

| 방식 | 사용법 |
|------|--------|
| 로그인 폼 | `--login-url=/login --login-id=admin --login-pw=pass` |
| 쿠키 | `--auth-cookie="session=abc123"` |
| Bearer 토큰 | `--auth-bearer="eyJ..."` |
| OAuth2/SSO | `--login-id=admin --login-pw=pass` (Keycloak, Google, Azure AD 리다이렉트 자동 감지) |

## 출력 구조

```
.reverse-engine/
├── analysis.json              # 정적 분석 결과
├── crawl-result.json          # 서비스 탐색 결과
├── crawl.log                  # 탐색 상세 로그
├── screenshots/               # 화면 스크린샷
├── reports/
│   ├── reverseng-report.xlsx  # Excel 리포트
│   └── component-graph.mmd   # Mermaid 다이어그램
└── tests/
    ├── e2e/                   # E2E 테스트 코드
    ├── api/                   # API 테스트 코드
    └── components/            # 컴포넌트 테스트 코드
```

## CLI 명령어

| 명령어 | 설명 |
|--------|------|
| `reverse-engine full [target]` | 전체 파이프라인 (분석 + 문서 + 테스트) |
| `reverse-engine crawl <url>` | 서비스 탐색만 |
| `reverse-engine analyze [path]` | 소스코드 분석만 |
| `reverse-engine report` | 리포트 생성만 |
| `reverse-engine test` | 테스트 코드 생성만 |

## 지원 프레임워크

React, Next.js, Vue, Nuxt, Angular, Svelte, Remix, TypeScript, JavaScript

## 프로그래매틱 API

```typescript
import { analyze, crawl, generateReport, generateTests } from 'reverse-engine';

const crawlResult = await crawl({
  url: 'http://localhost:3000',
  auth: { credentials: { email: 'admin', password: 'pass' } },
});

const analysis = await analyze('./my-project');

await generateReport(analysis, { formats: ['excel', 'mermaid'] });
await generateTests(analysis, { types: ['e2e', 'api'] });
```

## License

MIT
