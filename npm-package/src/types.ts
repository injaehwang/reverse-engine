/** 분석 결과 전체 */
export interface AnalysisResult {
  sourcePath: string;
  framework: string;
  components: ComponentInfo[];
  routes: RouteInfo[];
  functions: FunctionInfo[];
  apiClients: ApiClientCall[];
  dependencies: DependencyInfo[];
}

export interface ComponentInfo {
  name: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  componentType: 'Page' | 'Layout' | 'Widget' | 'Utility';
  props: PropInfo[];
  children: string[];
  usedBy: string[];
  hooks: string[];
  apiCalls: string[];
}

export interface PropInfo {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
}

export interface RouteInfo {
  path: string;
  component: string;
  filePath: string;
  guards: string[];
  meta?: Record<string, unknown>;
}

export interface FunctionInfo {
  name: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  params: string[];
  returnType?: string;
  calls: string[];
  calledBy: string[];
  isAsync: boolean;
  isExported: boolean;
}

export interface ApiClientCall {
  method: string;
  urlPattern: string;
  filePath: string;
  line: number;
  functionName: string;
}

export interface DependencyInfo {
  name: string;
  currentVersion: string;
  latestVersion?: string;
  depType: 'Production' | 'Development' | 'Peer';
  license?: string;
}

/** 크롤링 결과 */
export interface CrawlResult {
  targetUrl: string;
  pages: PageInfo[];
  timestamp: string;
}

export interface PageInfo {
  url: string;
  title: string;
  screenshotPath: string | null;
  elements: {
    links: { text: string; href: string; selector: string }[];
    buttons: { text: string; selector: string; navigatesTo: string | null }[];
    forms: { id: string | null; action: string | null; method: string; fields: { name: string; fieldType: string; required: boolean }[] }[];
  };
  apiCalls: { method: string; url: string; responseStatus: number; triggeredBy: string | null }[];
  navigatesTo: string[];
  authRequired: boolean;
}
