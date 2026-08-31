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
// "사실상 같은 글" 만 중복으로 본다. 0.05 는 이 도메인에서 필터가 아니었다 — 2026-08-31 실측
// (episodic_memory 1,700행)에서 최근접이웃 거리의 최댓값 자체가 0.1453 이고 0.05 이하가
// 1,370/1,696(80.8%) 이라, 무관한 쌍까지 전부 통과했다. 같은 실측에서 거리 0(문자열까지 동일)이
// 406행, 0.0005 이하가 456행 — 그 사이가 비어 있어 0.001 을 경계로 잡는다.
// 0.001~0.05 구간(부동소수 오차를 넘는 실제 차이)은 중복이 아니라 유사 사례로 두고 건드리지 않는다.
const DUPLICATE_MAX_DISTANCE = 0.001;
const LINT_ISSUE_CAP = 50;
// L4 거리 밴드 — "유사하나 동일 아님"(>0.15 는 무관).
// L1 임계를 0.001 로 내렸다고 밴드 하한을 따라 내리지 않는다: 후보는 거리 오름차순으로 잘리므로
// 하한을 0.001 로 두면 사실상 같은 쌍이 maxPairs 를 다 차지해 정작 볼 구간이 판정되지 않는다.
// 그 사이(0.001~0.05)는 실측상 무관한 쌍도 들어오는 거리라 애초에 모순 판정의 신호가 아니다.
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
    const outcome = await this.knowledgeLint.lintIssues({
      duplicateMaxDistance: DUPLICATE_MAX_DISTANCE,
      limit: LINT_ISSUE_CAP,
      l4: {
        enabled: this.isL4Enabled(),
        maxPairs: this.resolveL4MaxPairs(),
        minDistance: L4_BAND_MIN,
        maxDistance: L4_BAND_MAX,
      },
    });
    // 이슈 0건에도 skip 하지 않는다 — 주 1회(일 10:00) 발화라 skip 으로 끊으면 그 주에
    // 점검이 돌았는지 자체가 아무 데도 안 남는다(LLM 을 안 쓰는 구간은 agent_run 에도 없다).
    // 하트비트 문구와 점검 범위는 formatter 가 outcome.l4(실행 실태)로 판단한다 —
    // env 플래그는 "하려고 했다" 일 뿐 "실제로 판정했다" 가 아니다.
    return {
      skip: false,
      summaryText: formatKnowledgeLint(outcome, firedAtKst),
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
