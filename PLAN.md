# ReversEngine - 서비스 역분석 자동화 도구

## 프로젝트 비전

기존에 구축된 웹 서비스를 **메인 화면부터 시작**하여 모든 URL, 버튼, 화면, 함수 호출, 데이터 흐름을 자동으로 크롤링/분석하고, 그 결과를 **엑셀 문서**, **테스트 자동화 코드**, **컴포넌트 업그레이드 가이드**로 출력하는 올인원 역설계 도구.

---

## 하이브리드 아키텍처 (Rust + Node.js)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    reverseng CLI (Rust binary)                      │
│                    단일 바이너리, 빠른 시작, 크로스 플랫폼                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─ Rust 엔진 (성능 크리티컬) ──────────────────────────────────┐    │
│  │                                                               │    │
│  │  Analyzer      코드 정적 분석, AST 파싱 (tree-sitter)         │    │
│  │  Mapper        관계 그래프 구축, SQLite 저장 (rusqlite)       │    │
│  │  Upgrader      의존성 스캔, dead code 탐지                    │    │
│  │  Core          공통 타입, 직렬화 (serde), 설정 관리            │    │
│  │                                                               │    │
│  └───────────────────────────────────────────────────────────────┘    │
│          │ JSON/MessagePack IPC                                      │
│          ▼                                                           │
│  ┌─ Node.js 레이어 (생태계 활용) ───────────────────────────────┐    │
│  │                                                               │    │
│  │  Crawler       Playwright 브라우저 자동화, SPA 크롤링          │    │
│  │  DocGen        ExcelJS 문서 생성, Mermaid 다이어그램           │    │
│  │  TestGen       Playwright Test / Jest 테스트 코드 생성         │    │
│  │                                                               │    │
│  └───────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### 왜 하이브리드인가?

| 영역 | Rust를 쓰는 이유 | Node.js를 쓰는 이유 |
|------|------------------|---------------------|
| **코드 분석** | tree-sitter(Rust 네이티브)로 수백만 줄도 초 단위 파싱 | - |
| **관계 매핑** | 대규모 그래프 연산, 메모리 효율 | - |
| **의존성 스캔** | 병렬 파일 I/O, 빠른 패턴 매칭 | - |
| **CLI** | 단일 바이너리 배포, 즉시 시작 | - |
| **브라우저 크롤링** | - | Playwright는 Node.js 생태계 최강 |
| **Excel 생성** | - | ExcelJS가 가장 성숙한 라이브러리 |
| **테스트 생성** | - | 테스트 프레임워크가 JS 생태계 |

### 통신 방식
- Rust CLI가 **메인 오케스트레이터** 역할
- Node.js 프로세스를 **subprocess**로 실행하고 **JSON stdout/stdin** 으로 통신
- 대용량 데이터는 **공유 SQLite DB** 또는 **임시 JSON 파일**로 교환

---

## 핵심 모듈 구성 (6개 모듈)

```
┌─────────────────────────────────────────────────────────────────┐
│                   ReversEngine CLI (Rust)                        │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────┤
│ Module 1 │ Module 2 │ Module 3 │ Module 4 │ Module 5 │ Module 6 │
│ Crawler  │ Analyzer │ Mapper   │ DocGen   │ TestGen  │ Upgrader │
│ (수집)    │ (분석)    │ (매핑)    │ (문서화)   │ (테스트)   │ (유지보수) │
│ [Node]   │ [Rust]   │ [Rust]   │ [Node]   │ [Node]   │ [Rust]   │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘
       │          │          │          │          │          │
       ▼          ▼          ▼          ▼          ▼          ▼
   Playwright  tree-sitter rusqlite  ExcelJS   Playwright  cargo-audit
               + AST       + Graph   + Mermaid  Test/Jest   + fs scan
```

---

## Module 1: Crawler (서비스 수집기)

### 목적
메인 URL부터 시작하여 모든 도달 가능한 화면, URL, 버튼, 폼을 자동 탐색

### 기능 상세

| 기능 | 설명 | 기술 |
|------|------|------|
| **URL Discovery** | 페이지 내 모든 링크(`<a>`, `router-link`, `next/link` 등) 자동 수집 | Playwright |
| **Button/Action Discovery** | 클릭 가능한 요소 탐지 및 이벤트 핸들러 추적 | DOM Inspection |
| **Form Discovery** | 입력 폼, 필드, validation 규칙 수집 | DOM + Network |
| **API Intercept** | 각 화면에서 호출되는 API 엔드포인트, 메서드, 페이로드 캡처 | Network HAR |
| **Auth Flow** | 로그인/인증 흐름 자동 처리 (쿠키, 토큰 관리) | Session Manager |
| **SPA Support** | React/Vue/Angular 등 SPA 라우팅 동적 감지 | History API 감시 |
| **Screenshot** | 각 화면 자동 스크린샷 캡처 | Playwright |

### 출력 데이터 구조
```json
{
  "pages": [
    {
      "url": "/dashboard",
      "title": "대시보드",
      "screenshot": "./screenshots/dashboard.png",
      "elements": {
        "links": [{"text": "설정", "href": "/settings", "selector": "#nav-settings"}],
        "buttons": [{"text": "새 프로젝트", "selector": ".btn-new", "handler": "onClick→createProject()"}],
        "forms": [{"id": "search-form", "fields": [...], "action": "GET /api/search"}]
      },
      "apiCalls": [
        {"method": "GET", "url": "/api/dashboard/stats", "response": {...}}
      ],
      "navigatesTo": ["/settings", "/projects/new", "/api/search"]
    }
  ]
}
```

### 크롤링 전략
```
1. 시드 URL (메인화면) 입력
2. BFS(너비 우선 탐색) 방식으로 페이지 탐색
3. 각 페이지에서:
   a. DOM 스캔 → 클릭 가능한 요소 목록화
   b. 각 요소 클릭 → 새 URL/모달/상태변화 감지
   c. Network 감시 → API 호출 캡처
   d. 스크린샷 저장
4. 방문하지 않은 URL 큐에 추가
5. 최대 깊이/페이지 수 제한으로 무한루프 방지
6. 결과를 JSON으로 저장
```

---

## Module 2: Analyzer (코드 분석기)

### 목적
소스코드가 있는 경우, 정적 분석으로 함수 호출 체인, 컴포넌트 구조, 의존성 파악

### 기능 상세

| 기능 | 설명 | 기술 |
|------|------|------|
| **AST Parsing** | JS/TS/JSX/TSX/Vue/Python 등 소스코드 파싱 | @babel/parser, ts-morph, tree-sitter |
| **Component Tree** | 컴포넌트 계층 구조 추출 | AST 분석 |
| **Function Call Graph** | 함수 간 호출 관계 그래프 생성 | AST + Scope Analysis |
| **Route Mapping** | 라우터 설정 파일에서 URL↔컴포넌트 매핑 추출 | Pattern Matching |
| **State Management** | Redux/Vuex/Zustand 등 상태 관리 흐름 분석 | AST |
| **API Client Analysis** | axios/fetch 호출 패턴에서 API 엔드포인트 추출 | AST |
| **Dependency Analysis** | package.json, import문 분석으로 의존성 그래프 생성 | AST + npm |

### 분석 결과 구조
```json
{
  "components": [
    {
      "name": "Dashboard",
      "file": "src/pages/Dashboard.tsx",
      "props": ["userId", "dateRange"],
      "children": ["StatsCard", "ChartPanel", "ActivityFeed"],
      "hooks": ["useState", "useEffect", "useDashboardData"],
      "apiCalls": ["GET /api/stats", "GET /api/activities"],
      "stateAccess": ["user.profile", "dashboard.filters"],
      "functions": [
        {
          "name": "handleRefresh",
          "calls": ["fetchStats()", "updateLastRefresh()"],
          "calledBy": ["RefreshButton.onClick"]
        }
      ]
    }
  ],
  "routes": [
    {"path": "/dashboard", "component": "Dashboard", "guard": "AuthGuard"}
  ]
}
```

---

## Module 3: Mapper (관계 매핑 엔진)

### 목적
Crawler와 Analyzer의 결과를 통합하여 전체 서비스의 관계 그래프 구축

### 기능 상세

| 기능 | 설명 |
|------|------|
| **Screen Flow Graph** | 화면 간 이동 경로 (네비게이션 플로우) 시각화 |
| **API-Screen Binding** | 어떤 화면이 어떤 API를 호출하는지 매핑 |
| **Component-URL Binding** | URL과 소스코드 컴포넌트 1:1 매핑 |
| **Event Chain** | 버튼 클릭 → 함수 호출 → API 요청 → 상태 변경 전체 체인 |
| **Data Flow** | 데이터가 API → Store → Component → UI로 흐르는 경로 |
| **Cross-Reference** | 크롤링 결과와 코드 분석 결과 교차 검증 |

### 저장소
```
- SQLite (기본): 가볍고 설치 불필요, 단일 파일
- Neo4j (옵션): 복잡한 관계 쿼리가 필요한 대규모 서비스용
```

### 관계 스키마
```
[Page] --navigatesTo--> [Page]
[Page] --contains--> [Element(Button/Link/Form)]
[Element] --triggers--> [Function]
[Function] --calls--> [API Endpoint]
[API Endpoint] --returns--> [Data Schema]
[Page] --renderedBy--> [Component]
[Component] --imports--> [Component]
[Component] --uses--> [Hook/Store]
```

---

## Module 4: DocGen (문서 생성기)

### 목적
분석 결과를 사람이 읽기 좋은 Excel/Markdown/HTML 문서로 자동 생성

### Excel 출력 시트 구성

#### Sheet 1: 화면 목록
| No | URL | 화면명 | 스크린샷 | 설명 | 인증필요 | 비고 |
|----|-----|--------|----------|------|----------|------|
| 1 | /dashboard | 대시보드 | [link] | 메인 현황 화면 | Y | - |

#### Sheet 2: URL-API 매핑
| No | 화면URL | API Endpoint | Method | Request | Response | 호출시점 |
|----|---------|-------------|--------|---------|----------|----------|
| 1 | /dashboard | /api/stats | GET | - | {count,avg} | 페이지 로드 |

#### Sheet 3: 화면 흐름
| No | 출발화면 | 트리거 요소 | 동작 | 도착화면 | 조건 |
|----|----------|------------|------|----------|------|
| 1 | /login | 로그인 버튼 | POST /auth → redirect | /dashboard | 인증 성공시 |

#### Sheet 4: 컴포넌트 목록
| No | 컴포넌트명 | 파일경로 | Props | 사용처 | 하위컴포넌트 |
|----|-----------|----------|-------|--------|-------------|
| 1 | StatsCard | src/components/StatsCard.tsx | title,value,icon | Dashboard | - |

#### Sheet 5: 함수 호출 체인
| No | 함수명 | 파일 | 트리거 | 호출함수들 | API호출 | 상태변경 |
|----|--------|------|--------|-----------|---------|----------|
| 1 | handleRefresh | Dashboard.tsx | RefreshBtn.click | fetchStats | GET /api/stats | dashboard.data |

#### Sheet 6: 의존성 패키지
| No | 패키지명 | 현재버전 | 최신버전 | 취약점 | 라이선스 | 대체 권장 |
|----|----------|---------|---------|--------|----------|----------|
| 1 | react | 17.0.2 | 18.3.1 | 없음 | MIT | - |

### 추가 출력
- **Markdown 문서**: 각 화면별 상세 분석 문서
- **HTML 리포트**: 인터랙티브 시각화 (Mermaid 다이어그램 포함)
- **Mermaid Flowchart**: 화면 흐름도 자동 생성

---

## Module 5: TestGen (테스트 자동화 생성기)

### 목적
분석된 화면/API/흐름을 기반으로 E2E/통합/단위 테스트 코드 자동 생성

### 생성되는 테스트 종류

#### 5-1. E2E 테스트 (Playwright)
```typescript
// 자동 생성 예시: 대시보드 화면 테스트
test('Dashboard 페이지 로드 및 기본 요소 확인', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveTitle(/대시보드/);
  await expect(page.locator('.stats-card')).toHaveCount(4);
  await expect(page.locator('#nav-settings')).toBeVisible();
});

test('새 프로젝트 버튼 → 프로젝트 생성 화면 이동', async ({ page }) => {
  await page.goto('/dashboard');
  await page.click('.btn-new');
  await expect(page).toHaveURL('/projects/new');
});
```

#### 5-2. API 테스트
```typescript
// 자동 생성 예시: API 엔드포인트 테스트
test('GET /api/stats - 대시보드 통계 조회', async ({ request }) => {
  const response = await request.get('/api/stats');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toHaveProperty('count');
  expect(body).toHaveProperty('avg');
});
```

#### 5-3. 화면 흐름 테스트
```typescript
// 자동 생성 예시: 로그인 → 대시보드 전체 흐름
test('로그인 후 대시보드 진입 흐름', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#email', 'test@example.com');
  await page.fill('#password', 'password');
  await page.click('#btn-login');
  await expect(page).toHaveURL('/dashboard');
  await expect(page.locator('.welcome-message')).toContainText('환영합니다');
});
```

#### 5-4. 스냅샷/비주얼 리그레션 테스트
- 크롤링 시 캡처한 스크린샷을 baseline으로 사용
- 이후 변경 시 시각적 차이 자동 감지

### 테스트 커버리지 매트릭스
```
자동 생성 범위:
├── 모든 발견된 URL에 대한 접근성 테스트
├── 모든 버튼/링크에 대한 네비게이션 테스트
├── 모든 API 엔드포인트에 대한 상태코드/스키마 테스트
├── 모든 폼에 대한 입력/제출 테스트
├── 주요 사용자 흐름(로그인→기능사용→로그아웃) 테스트
└── 각 화면 비주얼 리그레션 테스트
```

---

## Module 6: Upgrader (유지보수/업그레이드 도구)

### 목적
의존성 취약점 검사, 컴포넌트 업그레이드 가이드, 코드 품질 개선 제안

### 기능 상세

| 기능 | 설명 |
|------|------|
| **Dependency Audit** | npm audit / pip audit 결과 + CVE 매핑 |
| **Version Diff** | 현재 버전 ↔ 최신 버전 breaking changes 목록화 |
| **Migration Guide** | 주요 라이브러리 업그레이드 단계별 가이드 생성 |
| **Dead Code Detection** | 사용되지 않는 컴포넌트/함수/라우트 탐지 |
| **Code Smell Detection** | 중복 코드, 과도한 복잡도, 안티패턴 탐지 |
| **Impact Analysis** | 특정 컴포넌트 변경 시 영향받는 화면/기능 목록 |

---

## 기술 스택

```
┌─ Rust 레이어 ─────────────────────────────────────────────┐
│  언어:          Rust 1.80+ (2024 edition)                  │
│  CLI:           clap v4 (서브커맨드, 컬러 출력)              │
│  코드 분석:      tree-sitter + 언어별 grammar               │
│  DB:            rusqlite (SQLite 바인딩)                    │
│  직렬화:         serde + serde_json                         │
│  병렬처리:       rayon (데이터 병렬), tokio (비동기 I/O)      │
│  파일탐색:       walkdir, glob                              │
│  의존성분석:     cargo-audit 패턴, advisory-db               │
│  프로세스관리:    tokio::process (Node.js 서브프로세스 제어)   │
└───────────────────────────────────────────────────────────┘

┌─ Node.js 레이어 ──────────────────────────────────────────┐
│  런타임:         Node.js 20+ (TypeScript)                  │
│  크롤링:         Playwright                                │
│  Excel:         ExcelJS                                   │
│  시각화:         Mermaid, D3.js                            │
│  테스트생성:     Playwright Test 코드 템플릿                 │
│  패키지관리:     pnpm                                      │
└───────────────────────────────────────────────────────────┘

┌─ 공유 ────────────────────────────────────────────────────┐
│  데이터교환:     JSON (stdout/stdin) + SQLite (대용량)       │
│  스키마:         JSON Schema로 Rust↔Node.js 타입 동기화      │
│  빌드:           Cargo workspace + pnpm workspace           │
└───────────────────────────────────────────────────────────┘
```

---

## 프로젝트 디렉토리 구조

```
reversengineering/
├── Cargo.toml                       # Rust workspace 루트
├── package.json                     # Node.js workspace 루트
├── pnpm-workspace.yaml
├── PLAN.md
│
├── crates/                          # ===== Rust 크레이트 =====
│   │
│   ├── reverseng-core/              # 공유 타입, 설정, 직렬화
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── config.rs            # 설정 파일 로드/파싱
│   │       ├── types/
│   │       │   ├── mod.rs
│   │       │   ├── crawler.rs       # CrawlResult, PageInfo
│   │       │   ├── analyzer.rs      # ComponentInfo, FunctionInfo
│   │       │   └── mapper.rs        # Relationship, GraphNode
│   │       └── ipc.rs               # Node.js 프로세스 통신
│   │
│   ├── reverseng-analyzer/          # Module 2: 코드 정적 분석
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── parsers/
│   │       │   ├── mod.rs
│   │       │   ├── typescript.rs    # TS/TSX (tree-sitter-typescript)
│   │       │   ├── javascript.rs    # JS/JSX (tree-sitter-javascript)
│   │       │   ├── vue.rs           # Vue SFC 파싱
│   │       │   └── python.rs        # Python (tree-sitter-python)
│   │       ├── extractors/
│   │       │   ├── mod.rs
│   │       │   ├── component.rs     # 컴포넌트 트리 추출
│   │       │   ├── route.rs         # 라우터 설정 추출
│   │       │   ├── function.rs      # 함수 호출 체인
│   │       │   ├── api_call.rs      # fetch/axios 호출 추출
│   │       │   └── state.rs         # 상태관리 패턴 추출
│   │       └── framework.rs         # 프레임워크 자동 감지
│   │
│   ├── reverseng-mapper/            # Module 3: 관계 매핑 엔진
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── db/
│   │       │   ├── mod.rs
│   │       │   ├── sqlite.rs        # rusqlite 저장소
│   │       │   └── schema.sql       # 테이블 정의
│   │       ├── graph.rs             # 관계 그래프 구축
│   │       └── cross_ref.rs         # 크롤링↔코드 교차검증
│   │
│   ├── reverseng-upgrader/          # Module 6: 유지보수 도구
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── audit.rs             # 의존성 취약점 검사
│   │       ├── version_diff.rs      # 버전 비교
│   │       ├── dead_code.rs         # 미사용 코드 탐지
│   │       └── impact.rs            # 변경 영향도 분석
│   │
│   └── reverseng-cli/               # CLI 바이너리 (메인 오케스트레이터)
│       ├── Cargo.toml
│       └── src/
│           ├── main.rs
│           └── commands/
│               ├── mod.rs
│               ├── crawl.rs         # reverseng crawl <url>
│               ├── analyze.rs       # reverseng analyze <path>
│               ├── report.rs        # reverseng report
│               ├── test.rs          # reverseng test
│               ├── upgrade.rs       # reverseng upgrade
│               └── full.rs          # reverseng full (전체 파이프라인)
│
├── node/                            # ===== Node.js 패키지 =====
│   │
│   ├── crawler/                     # Module 1: Playwright 크롤러
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── browser.ts           # 브라우저 인스턴스 관리
│   │       ├── page-scanner.ts      # DOM 요소 스캔
│   │       ├── network-interceptor.ts # API 호출 캡처 (HAR)
│   │       ├── auth-handler.ts      # 인증 흐름 처리
│   │       ├── screenshot.ts        # 스크린샷 캡처
│   │       └── queue.ts             # BFS 탐색 큐
│   │
│   ├── docgen/                      # Module 4: 문서 생성기
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── excel/
│   │       │   ├── workbook.ts
│   │       │   └── sheets/
│   │       │       ├── pages.ts
│   │       │       ├── api-map.ts
│   │       │       ├── flow.ts
│   │       │       ├── components.ts
│   │       │       ├── functions.ts
│   │       │       └── dependencies.ts
│   │       ├── markdown/
│   │       │   └── generator.ts
│   │       ├── html/
│   │       │   └── report.ts
│   │       └── mermaid/
│   │           └── flowchart.ts
│   │
│   └── testgen/                     # Module 5: 테스트 생성기
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── generators/
│           │   ├── e2e.ts
│           │   ├── api.ts
│           │   ├── flow.ts
│           │   └── visual.ts
│           └── templates/           # Handlebars/EJS 템플릿
│               ├── e2e.hbs
│               ├── api.hbs
│               └── flow.hbs
│
├── shared/                          # ===== Rust↔Node.js 공유 =====
│   └── schemas/                     # JSON Schema 정의
│       ├── crawl-result.schema.json
│       ├── analysis-result.schema.json
│       └── config.schema.json
│
├── output/                          # 분석 결과 출력
│   ├── screenshots/
│   ├── reports/
│   └── tests/
│
└── configs/
    └── reverseng.config.toml        # TOML 설정 (Rust 네이티브)
```

---

## CLI 사용 시나리오

### 시나리오 1: 전체 자동 분석
```bash
# 웹 서비스 URL + 소스코드 경로를 지정하여 전체 분석
reverseng full \
  --url https://my-service.com \
  --source ./my-project \
  --auth '{"email":"admin@test.com","password":"1234"}' \
  --output ./output \
  --max-depth 5 \
  --max-pages 100
```

### 시나리오 2: 크롤링만 실행
```bash
# 소스코드 없이 URL만으로 화면/API 수집
reverseng crawl https://my-service.com \
  --auth-cookie "session=abc123" \
  --screenshot \
  --har
```

### 시나리오 3: 코드 분석만 실행
```bash
# 소스코드만으로 정적 분석
reverseng analyze ./my-project \
  --framework react \
  --include "src/**/*.{ts,tsx}"
```

### 시나리오 4: 리포트 생성
```bash
# 이전 분석 결과로 Excel + HTML 리포트 생성
reverseng report \
  --input ./output/analysis.json \
  --format excel,html,markdown
```

### 시나리오 5: 테스트 생성
```bash
# 분석 결과로 테스트 코드 자동 생성
reverseng test \
  --input ./output/analysis.json \
  --type e2e,api,visual \
  --output ./tests
```

---

## 설정 파일 (reverseng.config.ts)

```typescript
import { defineConfig } from '@reverseng/core';

export default defineConfig({
  // 대상 서비스
  target: {
    url: 'https://my-service.com',
    sourcePath: './my-project',
  },

  // 크롤링 설정
  crawler: {
    maxDepth: 5,              // 최대 탐색 깊이
    maxPages: 200,            // 최대 페이지 수
    timeout: 30000,           // 페이지 로드 타임아웃
    waitAfterClick: 1000,     // 클릭 후 대기시간
    viewport: { width: 1920, height: 1080 },
    ignorePatterns: ['/logout', '/external-*'],
    auth: {
      type: 'form',           // form | cookie | bearer | custom
      loginUrl: '/login',
      credentials: { email: 'admin@test.com', password: '1234' },
      submitSelector: '#btn-login',
    },
  },

  // 코드 분석 설정
  analyzer: {
    framework: 'auto',        // auto | react | vue | angular | next | nuxt
    include: ['src/**/*.{ts,tsx,js,jsx,vue}'],
    exclude: ['node_modules', 'dist', '*.test.*'],
    routerFile: 'auto',       // 자동 감지 또는 명시적 경로
  },

  // 출력 설정
  output: {
    dir: './output',
    formats: ['excel', 'html', 'markdown'],
    screenshots: true,
    mermaid: true,
  },

  // 테스트 생성 설정
  testgen: {
    types: ['e2e', 'api', 'visual'],
    outputDir: './tests/generated',
    baseUrl: 'http://localhost:3000',
  },
});
```

---

## 구현 로드맵

### Phase 1: 핵심 기반 (MVP)
- [ ] 프로젝트 초기 설정 (monorepo, TypeScript, ESLint)
- [ ] `core` 패키지: 공통 타입 정의
- [ ] `crawler` 패키지: 기본 URL 탐색 + 스크린샷
- [ ] `docgen` 패키지: 기본 Excel 출력 (화면 목록, URL-API 매핑)
- [ ] `cli` 앱: crawl, report 명령어

### Phase 2: 코드 분석
- [ ] `analyzer` 패키지: React/Vue/TS 정적 분석
- [ ] `mapper` 패키지: SQLite 기반 관계 매핑
- [ ] `docgen` 확장: 컴포넌트/함수 시트 추가
- [ ] `cli` 확장: analyze 명령어

### Phase 3: 테스트 자동화
- [ ] `testgen` 패키지: E2E/API 테스트 생성
- [ ] 비주얼 리그레션 테스트 지원
- [ ] `cli` 확장: test 명령어

### Phase 4: 유지보수 도구
- [ ] `upgrader` 패키지: 의존성 감사, 버전 비교
- [ ] Dead code 탐지
- [ ] 변경 영향도 분석
- [ ] `cli` 확장: upgrade 명령어

### Phase 5: 웹 대시보드
- [ ] 분석 결과 웹 시각화
- [ ] 인터랙티브 화면 흐름도
- [ ] 실시간 크롤링 진행상황 모니터링

---

## 핵심 설계 원칙

1. **점진적 분석**: 소스코드 없이 URL만으로도 동작, 소스코드가 있으면 더 깊은 분석
2. **프레임워크 무관**: React, Vue, Angular, Next.js, Nuxt 등 자동 감지
3. **재실행 가능**: 결과를 JSON으로 저장하여 리포트/테스트를 반복 생성 가능
4. **확장 가능**: 플러그인 구조로 새로운 파서/생성기 추가 용이
5. **한국어 우선**: CLI 메시지, 리포트 모두 한국어 기본 지원
