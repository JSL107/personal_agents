import { Inject, Injectable } from '@nestjs/common';

import {
  KNOWLEDGE_LINT_PORT,
  KnowledgeLintPort,
} from '../../../episodic-memory/domain/port/knowledge-lint.port';
import { formatKnowledgeLint } from '../../../slack/format/knowledge-lint.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 주간 episodic-memory 무결성 점검 — near-duplicate(중복) / embedding-null(검색 사각지대) 보고. LLM 없음.
// 이슈 0건이면 skip(빈 알림 방지, run-retro 패턴). v1 은 읽기 전용(T0_AUTO) — 폐기/삭제는 v2(T1_PREVIEW).
const DUPLICATE_MAX_DISTANCE = 0.05;
const LINT_ISSUE_CAP = 50;

@Injectable()
export class KnowledgeLintAutopilotTask implements AutopilotTask {
  readonly id = 'knowledge-lint';

  constructor(
    @Inject(KNOWLEDGE_LINT_PORT)
    private readonly knowledgeLint: KnowledgeLintPort,
  ) {}

  async run({
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const issues = await this.knowledgeLint.lintIssues({
      duplicateMaxDistance: DUPLICATE_MAX_DISTANCE,
      limit: LINT_ISSUE_CAP,
    });
    if (issues.length === 0) {
      return { skip: true };
    }
    return { skip: false, slackText: formatKnowledgeLint(issues, firedAtKst) };
  }
}
