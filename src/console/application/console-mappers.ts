import { LocalSession } from '../../local-sessions/domain/local-session.type';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  PreviewAction,
  PreviewKind,
} from '../../preview-gate/domain/preview-action.type';
import { ConsoleApproval, ConsoleSession } from '../domain/console.type';

// PreviewKind → 담당 에이전트. 승인 카드가 어느 에이전트 소산인지(오피스 집결·핑크·클릭 대상).
// Record 타입이라 새 kind 추가 시 컴파일 에러로 매핑 누락을 막는다.
// null 은 특정 에이전트의 승인이 아닌 kind(예: 세션 주입) — 오피스 집결 대상이 아니다.
export const PREVIEW_KIND_TO_AGENT: Record<PreviewKind, AgentType | null> = {
  PM_WRITE_BACK: AgentType.PM,
  PO_EVAL_CAREERLOG: AgentType.PO_EVAL,
  CAREER_JD_GAP_BLOG: AgentType.CAREER_MATE,
  DOCS_AUDIT_PR: AgentType.DOCS_AUDIT_OPTIMIZER,
  PREFERENCE_PROFILE: AgentType.PREFERENCE_LEARNING,
  AI_CLI_ENV_APPLY: null,
  EVENING_BLOG_PUBLISH: AgentType.EVENING_RETRO,
  BLOG_GITHUB_PUBLISH: AgentType.BLOG_PUBLISH,
  EVENING_CAREER_REFLECT: AgentType.EVENING_RETRO,
  // 분배를 확정하는 승인이라 카드 주인은 실행될 BE worker 가 아니라 분배자인 CTO 다.
  SESSION_INJECT: null,
};

// PreviewAction → 콘솔 승인 뷰. 스냅샷 조립(ConsoleReadService)과 승인 이벤트 emit(preview-gate)이 공유.
export function toConsoleApproval(preview: PreviewAction): ConsoleApproval {
  return {
    id: preview.id,
    agentType: PREVIEW_KIND_TO_AGENT[preview.kind],
    title: preview.previewText,
    createdAt: preview.createdAt.toISOString(),
    expiresAt: preview.expiresAt.toISOString(),
  };
}

// LocalSession → 콘솔 세션 뷰. Date 필드를 ISO 문자열로 직렬화한다(Swift Codable 계약).
export function toConsoleSession(local: LocalSession): ConsoleSession {
  return {
    sessionId: local.sessionId,
    pid: local.pid,
    source: local.source,
    name: local.name,
    cwd: local.cwd,
    state: local.state,
    startedAt: local.startedAt.toISOString(),
    lastActivityAt:
      local.lastActivityAt === null ? null : local.lastActivityAt.toISOString(),
  };
}
