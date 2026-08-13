import { Inject, Injectable } from '@nestjs/common';

import { AgentRunStatus } from '../domain/agent-run.type';
import {
  AGENT_RUN_REPOSITORY_PORT,
  AgentRunRepositoryPort,
  FailedRunSnapshot,
} from '../domain/port/agent-run.repository.port';

// agentType 별 inputSnapshot 키 합집합 (모두 optional). Prisma agent_run.input_snapshot 은 Json 이라
// 본질적으로 unknown 이지만, /retry-run 핸들러에서 키 접근 시 매번 `as string` cast 해야 했던 가독성/타입
// 안전성을 type 으로 문서화 (V3 mid-progress audit B2 #3 — RetryRunPayload union type 강화).
//
// runtime validation 은 여전히 핸들러가 책임 (typeof + 본인 user_id 매칭) — type 만으로는 안전성 보장 X.
export interface AgentRetryInputSnapshot {
  slackUserId?: string;
  tasksText?: string; // PM
  workText?: string; // WORK_REVIEWER
  prRef?: string; // CODE_REVIEWER
  // CODE_REVIEWER — 최초 실행이 GitHub 게시까지 하기로 했는지. 재실행이 이 값을 보고
  // 같은 결정을 재현한다(없으면 미게시 = 스윕·연습 모드의 종전 동작).
  publish?: boolean;
  subject?: string; // IMPACT_REPORTER / BE
  request?: string; // BE_SCHEMA
  filePath?: string; // BE_TEST
  stackTrace?: string; // BE_SRE
  extraContextLength?: number; // PO_SHADOW
  dailyPlanAgentRunId?: number; // CTO — 분배 대상 PM run id
  range?: 'TODAY' | 'WEEK'; // PO_EVAL — 합성 기간
  workReviewerRunId?: number; // PO_EVAL — 합성 source
  poShadowRunId?: number; // PO_EVAL — 합성 source
  impactReporterRunId?: number; // PO_EVAL — 합성 source
  // CEO (P5 Meta) — 합성 source. range 는 PO_EVAL 과 공유 (위에 정의됨).
  poEvalRunId?: number; // CEO — 합성 source (필수)
  pmRunId?: number; // CEO — 합성 source (선택)
  ctoRunId?: number; // CEO — 합성 source (선택)
  // PAPER_RECOMMEND — 원래 전략과 판단 시각을 고정해 다른 전략/날짜의 주문을 만들지 않는다.
  strategy?: 'LONG_TERM' | 'SWING';
  decidedAt?: string;
  prompt?: string;
  ruleVersion?: number;
}

export interface RetryRunPayload {
  id: number;
  agentType: string;
  inputSnapshot: AgentRetryInputSnapshot;
}

@Injectable()
export class RetryRunUsecase {
  constructor(
    @Inject(AGENT_RUN_REPOSITORY_PORT)
    private readonly repository: AgentRunRepositoryPort,
  ) {}

  async execute({ id }: { id: number }): Promise<RetryRunPayload | null> {
    const run: FailedRunSnapshot | null = await this.repository.findById(id);
    if (!run || run.status !== AgentRunStatus.FAILED) {
      return null;
    }
    return {
      id: run.id,
      agentType: run.agentType,
      // Prisma JSON → unknown — 핸들러가 typeof + Array.isArray 가드로 형식 검증 후 typed 키 접근.
      // 잘못된 형식의 inputSnapshot 은 핸들러가 사용자에게 "형식이 올바르지 않다" 응답으로 안내.
      inputSnapshot: run.inputSnapshot as AgentRetryInputSnapshot,
    };
  }
}
