import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

// 주간 episodic-memory 무결성 점검 — L1 near-duplicate / L2 embedding-null(결정론, LLM 없음)
// + L4 contradiction(ChatGPT 모순 판정, env 게이트 + 쿼터 가드). 이슈 0건이면 skip. T0_AUTO(읽기 전용).
const DUPLICATE_MAX_DISTANCE = 0.05;
const LINT_ISSUE_CAP = 50;
// L4 거리 밴드 — "유사하나 동일 아님"(<=0.05 는 L1 중복, >0.15 는 무관).
const L4_BAND_MIN = 0.05;
const L4_BAND_MAX = 0.15;
const DEFAULT_L4_MAX_PAIRS = 5;

@Injectable()
export class KnowledgeLintAutopilotTask implements AutopilotTask {
  readonly id = 'knowledge-lint';

  constructor(
    @Inject(KNOWLEDGE_LINT_PORT)
    private readonly knowledgeLint: KnowledgeLintPort,
    private readonly configService: ConfigService,
  ) {}

  async run({
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const issues = await this.knowledgeLint.lintIssues({
      duplicateMaxDistance: DUPLICATE_MAX_DISTANCE,
      limit: LINT_ISSUE_CAP,
      l4: {
        enabled: this.isL4Enabled(),
        maxPairs: this.resolveL4MaxPairs(),
        minDistance: L4_BAND_MIN,
        maxDistance: L4_BAND_MAX,
      },
    });
    if (issues.length === 0) {
      return { skip: true };
    }
    return {
      skip: false,
      summaryText: formatKnowledgeLint(issues, firedAtKst),
    };
  }

  // 미설정 시 활성 — 'false' 일 때만 L4 비활성(L1/L2 는 유지).
  private isL4Enabled(): boolean {
    return (
      this.configService.get<string>('AUTOPILOT_KNOWLEDGE_LINT_L4_ENABLED') !==
      'false'
    );
  }

  // codex 쿼터 가드 — 미설정/비정상 값이면 기본 5.
  private resolveL4MaxPairs(): number {
    const raw = this.configService.get<string>(
      'AUTOPILOT_KNOWLEDGE_LINT_L4_MAX_PAIRS',
    );
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0
      ? parsed
      : DEFAULT_L4_MAX_PAIRS;
  }
}
