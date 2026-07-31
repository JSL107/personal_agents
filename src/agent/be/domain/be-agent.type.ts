import { ConversationContext } from '../../../router/domain/conversation-context.type';

// /plan-task 입력: 분해할 백엔드 작업 자유 텍스트 + (선택) PR/이슈 링크.
export interface GenerateBackendPlanInput {
  subject: string;
  slackUserId: string;
  // 자연어 진입 시 router 가 전달하는 대화 맥락 — userInstruction 을 prompt 최상단에 반영.
  // 슬래시 /plan-task 진입은 미주입 (기존 동작).
  conversationContext?: ConversationContext;
  // 호출자가 이미 알고 있는 PR 참조(owner/repo#N) — subject 에 작업 설명을 남긴 채 GitHub 본문만
  // 추가로 ground 할 때 사용. subject 자체가 PR 참조인 경우와 달리 조회 실패해도 subject 로
  // plan 을 세울 수 있으므로 예외 없이 진행한다.
  prReferenceHint?: string;
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
