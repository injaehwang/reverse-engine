# reverse-engine

웹 서비스 역분석 자동화 도구

소스코드 또는 실행 중인 서비스 URL을 넣으면 **모든 화면/API/흐름을 자동 수집**하고, **Excel 문서**, **Mermaid 다이어그램**, **테스트 코드**를 생성합니다.

## 설치

```bash
npm install -g reverse-engine
```

## 빠른 시작

```bash
# 프로젝트 폴더에서 그냥 실행
cd my-project
reverse-engine

# 실행 중인 서비스 크롤링
reverse-engine full http://localhost:3000

# 로그인이 필요한 서비스
reverse-engine full http://localhost:3000 \
  --login-url=/login \
  --login-id=admin@test.com \
  --login-pw=password123
```

결과는 `.reverse-engine/` 폴더에 자동 생성됩니다.

## 두 가지 분석 모드

### 1. 라이브 크롤링 (URL)

실행 중인 서비스를 Playwright 브라우저로 자동 탐색합니다.

```bash
reverse-engine full http://localhost:3000
```

- 메인 화면부터 BFS 방식으로 모든 페이지 탐색
- 화면에 보이는 모든 클릭 가능한 요소를 실제로 클릭
- 모달, 팝업, 드롭다운 자동 감지 및 스크린샷
- 폼 자동 작성 → 제출 → 다음 단계 추적 (멀티스텝 지원)
- API 호출 자동 캡처 (XHR/fetch)
- 모든 화면의 스크린샷 저장

### 2. 소스코드 분석 (경로)

프로젝트 소스코드를 정적 분석합니다.

```bash
reverse-engine full ./my-project
```

- 컴포넌트 트리 추출 (props, hooks, 하위 컴포넌트)
- 함수 호출 체인 (누가 누구를 호출하는지)
- API 엔드포인트 추출 (fetch, axios, $http)
- 라우트 매핑 (React Router, Vue Router, Next.js 파일 기반)
- 의존성 목록 (prod/dev/peer)

### 3. 동시 실행

```bash
reverse-engine full http://localhost:3000 --source ./my-project
```

크롤링 결과와 소스코드 분석 결과를 하나의 리포트로 통합합니다.

## 인증 지원

| 방식 | 사용법 |
|------|--------|
| 로그인 폼 | `--login-url=/login --login-id=admin --login-pw=pass` |
| 쿠키 | `--auth-cookie="session=abc123"` |
| Bearer 토큰 | `--auth-bearer="eyJ..."` |
| Keycloak SSO | `--login-id=admin --login-pw=pass` (자동 리다이렉트 감지) |

## 출력물

```
.reverse-engine/
├── analysis.json              # 분석 결과 (JSON)
├── crawl-result.json          # 크롤링 결과 (JSON)
├── crawl.log                  # 크롤링 상세 로그
├── screenshots/               # 모든 화면 스크린샷
│   ├── 001_page_main.png
│   ├── 002_click_설정.png
│   ├── 003_form_filled.png
│   └── ...
├── reports/
│   ├── reverseng-report.xlsx  # Excel 리포트
│   └── component-graph.mmd   # Mermaid 다이어그램
└── tests/
    ├── e2e/pages.spec.ts
    ├── api/endpoints.spec.ts
    └── components/*.spec.ts
```

### Excel 리포트

| 시트 | 내용 |
|------|------|
| 화면 목록 | URL, 화면명, 스크린샷, 링크/버튼/API 수 |
| API 호출 | 화면별 API 엔드포인트, Method, Status |
| 화면 흐름 | 출발화면 → 트리거 → 도착화면 |
| 컴포넌트 목록 | 이름, 파일, 타입, Props, Hooks |
| 함수 호출 체인 | 호출/피호출 관계, async/export |
| 의존성 패키지 | 패키지명, 버전, prod/dev |

## CLI 명령어

| 명령어 | 설명 |
|--------|------|
| `reverse-engine` | 인자 없이 실행 (현재 디렉토리 분석) |
| `reverse-engine full [target]` | 전체 파이프라인 |
| `reverse-engine analyze [path]` | 소스코드 분석만 |
| `reverse-engine crawl <url>` | 크롤링만 |
| `reverse-engine report` | 리포트 생성만 |
| `reverse-engine test` | 테스트 코드 생성만 |

## 지원 프레임워크

React, Next.js, Vue, Nuxt, Angular, Svelte, TypeScript, JavaScript

## 프로그래매틱 API

```typescript
import { analyze, crawl, generateReport, generateTests } from 'reverse-engine';

// 소스코드 분석
const result = await analyze('./my-project');

// 라이브 크롤링
const crawlResult = await crawl({
  url: 'http://localhost:3000',
  auth: { loginUrl: '/login', credentials: { email: 'admin', password: 'pass' } },
});

// 리포트 + 테스트 생성
await generateReport(result, { formats: ['excel', 'mermaid'] });
await generateTests(result, { types: ['e2e', 'api'] });
```

## License

MIT
