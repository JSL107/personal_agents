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
  subject?: string; // IMPACT_REPORTER / BE / PO_EXPAND
  request?: string; // BE_SCHEMA
  filePath?: string; // BE_TEST
  stackTrace?: string; // BE_SRE
  extraContextLength?: number; // PO_SHADOW
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
