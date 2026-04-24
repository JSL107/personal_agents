// /plan-task 입력: 분해할 백엔드 작업 자유 텍스트 + (선택) PR/이슈 링크.
export interface GenerateBackendPlanInput {
  subject: string;
  slackUserId: string;
}

// 구현 단위 체크리스트 — 에이전트가 WBS 로 쪼갠 item 하나.
export interface ImplementationCheckItem {
  title: string;
  description: string;
  dependsOn: string[]; // 선행 item 의 title — 순서 의존성 표기 (없으면 빈 배열)
}

// API 설계 포인트 — REST endpoint 기준 (GraphQL / 이벤트 흐름이면 method/path 는 자유 텍스트).
export interface ApiDesignPoint {
  method: string; // GET/POST/PUT/PATCH/DELETE 또는 "QUEUE"/"EVENT"
  path: string;
  request: string; // query/body 요약
  response: string;
  notes: string; // 인증/권한/트랜잭션 등
}

export interface BackendPlan {
  subject: string;
  context: string;
  implementationChecklist: ImplementationCheckItem[];
  apiDesign: ApiDesignPoint[] | null; // API 가 주된 작업이 아니면 null
  risks: string[];
  testPoints: string[];
  estimatedHours: number;
  reasoning: string;
}
