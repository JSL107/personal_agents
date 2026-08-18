import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { ConversationContext } from '../../../router/domain/conversation-context.type';

// CTO 의 분배 후보 — review 합의에 따라 BE_SRE / BE_FIX 는 webhook 자동 트리거 영역이라 제외.
// BE / BE_SCHEMA / BE_TEST 만 사용자 트리거로 분배 가능.
export type BeAssignmentType =
  | AgentType.BE
  | AgentType.BE_SCHEMA
  | AgentType.BE_TEST;

export interface Assignment {
  // PM plan 의 morning/afternoon TaskItem.id — assignableTaskIds 안의 1개.
  taskId: string;
  // PM plan 의 task title (사용자 가시 메시지). LLM 이 plan JSON 에서 추출.
  taskTitle: string;
  beAssignment: BeAssignmentType;
  priority: 1 | 2 | 3;
  // 한 줄 분배 근거 — 사용자가 결과 검토 시 read.
  reasoning: string;
  // 0~1 — LLM 의 분배 확신도. 0.6 미만이면 사용자 confirm 권장 (formatter 에서 ⚠️ 표시).
  confidence: number;
  // BE_TEST 분배 시 LLM 이 task 설명에서 추론한 spec 대상 파일 경로 (e.g. "src/foo/bar.service.ts").
  // 다른 worker (BE / BE_SCHEMA) 에는 의미 없음 — optional. auto-flow chain 에서 BE_TEST dispatch
  // 시 본 필드 있으면 자동 주입, 없으면 SKIPPED (사용자가 /be-test 별도 호출).
  targetFilePath?: string;
}

// 자동 분배 불가 한 task — taskId + 사용자에게 결정 요청할 사유.
// codex review 권장: first-class output 으로 노출, /assign 재시도 시 사용자가 worker override.
export interface UnassignedTask {
  taskId: string;
  taskTitle: string;
  reason: string;
}

export interface AssignmentOutput {
  assignments: Assignment[];
  unassignedTasks: UnassignedTask[];
  // 전체 분배 정책 / context 요약 — 사용자 가시 footer.
  ctoSummary: string;
}

// 직전 분배 결과를 이번 실행 prompt 로 되먹이기 위한 참조.
// 사용자가 "3번은 테스트로 바꿔줘" 처럼 자연어로 재배정을 요청하면, CTO 는 PM plan 만 보고
// 처음부터 다시 분배하는 대신 이 직전 결과를 이어받아 언급된 task 만 고친다 (나머지 유지).
export interface PriorAssignmentRef {
  agentRunId: number;
  output: AssignmentOutput;
}

// BE chain 안 worker 1건의 실행 결과.
// SKIPPED — 실행 전 가드에 걸림 (BE_TEST 의 targetFilePath 누락 / repo 에 없는 경로).
// FAILED  — worker usecase 가 throw. chain 은 멈추지 않고 다음 assignment 로 진행한다.
export type BeChainStatus = 'OK' | 'SKIPPED' | 'FAILED';

export interface BeChainOutcome {
  assignment: Assignment;
  status: BeChainStatus;
  agentRunId?: number;
  message: string;
}

// PREVIEW_KIND.CTO_BE_CHAIN 의 payload.
// assignments 를 카드 생성 시점 그대로 담는다 — 사용자가 본 분배와 실행되는 분배를 일치시킨다
// (승인 시점에 run 을 재조회하면 그 사이 재분배가 끼어들어 다른 게 실행될 수 있다).
export interface CtoBeChainPayload {
  ctoAgentRunId: number;
  slackUserId: string;
  assignments: Assignment[];
  // 카드를 다시 그릴 때 필요한 표시용 정보. 드롭다운으로 배정을 바꾸면 카드를 재렌더하는데,
  // 그 시점에 CTO run 을 다시 읽지 않아도 되도록 카드가 자기 표시 내용을 들고 있게 한다.
  // 실행에는 쓰이지 않는다 (applier 는 assignments 만 본다) — 과거 카드 호환 위해 optional.
  ctoSummary?: string;
  unassignedTasks?: UnassignedTask[];
}

export interface GenerateAssignmentInput {
  slackUserId: string;
  triggerType?: TriggerType;
  // 명시 지정 시 해당 PM run 의 assignableTaskIds 분배. 미지정 시 직전 PM run 자동 조회.
  dailyPlanAgentRunId?: number;
  // 자연어 진입 시 router 가 전달하는 대화 맥락 — userInstruction(직전 대화 기반 사용자 지시)을
  // prompt [사용자 지시] 섹션으로 반영. 슬래시 /assign 진입은 미주입 (기존 동작).
  conversationContext?: ConversationContext;
}

export interface StudyConceptVerdict {
  kind: 'CONCEPT';
  whyNow: string;
  whereItLands: string;
  minutes: number;
}

export interface StudyToolVerdict {
  kind: 'TOOL';
  whatImproves: string;
  adoptionCost: string;
  caution?: string;
  minutes: number;
}

export type StudyTopicVerdict = StudyConceptVerdict | StudyToolVerdict;

export type StudyTopicKind = 'CONCEPT' | 'TOOL';

export interface StudyTopicResearch {
  kind: StudyTopicKind;
  topic: string;
  reportMd: string;
  sourceUrls: readonly string[];
}

export interface RepoModuleSummary {
  name: string;
  description: string;
}

export interface EvaluateStudyTopicInput {
  slackUserId: string;
  research: StudyTopicResearch;
  profileSummary?: string;
  profileSkills?: readonly string[];
  repoModules?: readonly RepoModuleSummary[];
}
