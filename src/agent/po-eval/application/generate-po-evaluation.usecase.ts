import { Injectable, Logger } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { SucceededAgentRunSnapshot } from '../../../agent-run/domain/port/agent-run.repository.port';
import { AgentRunRange } from '../../../common/domain/agent-run-range.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { PoEvalException } from '../domain/po-eval.exception';
import {
  EvaluationInput,
  EvaluationOutput,
  SubAgentRunRefs,
} from '../domain/po-eval.type';
import { PoEvalErrorCode } from '../domain/po-eval-error-code.enum';
import { parseEvaluationOutput } from '../domain/prompt/evaluation.parser';
import {
  MAX_SUB_AGENT_OUTPUT_BYTES,
  PO_EVAL_SYSTEM_PROMPT,
} from '../domain/prompt/po-eval-system.prompt';

// V3 phase P4 Evaluate — 3 sub-agent (WORK_REVIEWER / PO_SHADOW / IMPACT_REPORTER) 의
// successful run snapshot 을 모아 LLM 1회 (Claude) 로 합성 → EvaluationOutput.
// review 합의 (omc:critic + omc:architect + codex):
//   - WEEK default (이력서/careerLog 의 자연 단위).
//   - TODAY 시 findRecentSucceededRuns({ sinceDays: 1 }) — findLatestSucceededRun 은 날짜 필터 X.
//   - 일부 sub-agent run 만 있어도 graceful (모두 null 일 때만 NO_SUB_AGENT_RUNS).
//   - 각 sub-agent output 직렬화 결과를 MAX_SUB_AGENT_OUTPUT_BYTES 로 UTF-8 byte tail truncate.
//   - AgentRunModule 만 import (sub-agent module 의존 X — type only).

const TRUNCATE_SUFFIX = '\n... (생략됨 — sub-agent output cap)';
const WEEK_SINCE_DAYS = 7;
const TODAY_SINCE_DAYS = 1;

interface SubAgentSnapshots {
  workReviewer: SucceededAgentRunSnapshot | null;
  poShadow: SucceededAgentRunSnapshot | null;
  impactReporter: SucceededAgentRunSnapshot | null;
}

@Injectable()
export class GeneratePoEvaluationUsecase {
  private readonly logger = new Logger(GeneratePoEvaluationUsecase.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({
    slackUserId,
    range = 'WEEK',
  }: EvaluationInput): Promise<AgentRunOutcome<EvaluationOutput>> {
    const snapshots = await this.collectSnapshots({ slackUserId, range });
    const refs = this.toRefs(snapshots);
    if (
      refs.workReviewerRunId === undefined &&
      refs.poShadowRunId === undefined &&
      refs.impactReporterRunId === undefined
    ) {
      throw new PoEvalException({
        code: PoEvalErrorCode.NO_SUB_AGENT_RUNS,
        message:
          range === 'WEEK'
            ? '최근 7일 내 Work Reviewer / PO Shadow / Impact Reporter 의 성공 run 이 없습니다. `/worklog` `/po-shadow` `/impact-report` 중 한 번이라도 실행해주세요.'
            : '최근 24시간 내 Work Reviewer / PO Shadow / Impact Reporter 의 성공 run 이 없습니다. range 를 week 로 늘리거나 sub-agent 를 실행해주세요.',
        status: DomainStatus.NOT_FOUND,
      });
    }

    return this.agentRunService.execute({
      agentType: AgentType.PO_EVAL,
      triggerType: TriggerType.SLACK_COMMAND_PO_EVAL,
      inputSnapshot: {
        slackUserId,
        range,
        workReviewerRunId: refs.workReviewerRunId,
        poShadowRunId: refs.poShadowRunId,
        impactReporterRunId: refs.impactReporterRunId,
      },
      evidence: this.toEvidence(refs),
      run: async () => {
        const prompt = buildPrompt({ snapshots, range });
        const completion = await this.modelRouter.route({
          agentType: AgentType.PO_EVAL,
          request: { prompt, systemPrompt: PO_EVAL_SYSTEM_PROMPT },
        });
        const partial = parseEvaluationOutput(completion.text);
        const output: EvaluationOutput = {
          range,
          sourceAgentRuns: refs,
          qualitative: partial.qualitative,
          careerLog: partial.careerLog,
        };
        this.logger.log(
          `PO_EVAL 합성 완료 — range=${range} refs=[${[refs.workReviewerRunId, refs.poShadowRunId, refs.impactReporterRunId].filter((id) => id !== undefined).join(',')}]`,
        );
        return {
          result: output,
          modelUsed: completion.modelUsed,
          output,
        };
      },
    });
  }

  // range 별 분기 — TODAY 는 sinceDays=1, WEEK 는 7. limit=1 로 가장 최근만.
  // findLatestSucceededRun 은 날짜 필터 X 라 TODAY 의도와 어긋남 (review omc:critic 핵심 지적).
  private async collectSnapshots({
    slackUserId,
    range,
  }: {
    slackUserId: string;
    range: AgentRunRange;
  }): Promise<SubAgentSnapshots> {
    const sinceDays = range === 'WEEK' ? WEEK_SINCE_DAYS : TODAY_SINCE_DAYS;
    const fetchLatestInRange = async (
      agentType: AgentType,
    ): Promise<SucceededAgentRunSnapshot | null> => {
      const runs = await this.agentRunService.findRecentSucceededRuns({
        agentType,
        slackUserId,
        sinceDays,
        limit: 1,
      });
      return runs[0] ?? null;
    };
    const [workReviewer, poShadow, impactReporter] = await Promise.all([
      fetchLatestInRange(AgentType.WORK_REVIEWER),
      fetchLatestInRange(AgentType.PO_SHADOW),
      fetchLatestInRange(AgentType.IMPACT_REPORTER),
    ]);
    return { workReviewer, poShadow, impactReporter };
  }

  private toRefs(snapshots: SubAgentSnapshots): SubAgentRunRefs {
    return {
      workReviewerRunId: snapshots.workReviewer?.id,
      poShadowRunId: snapshots.poShadow?.id,
      impactReporterRunId: snapshots.impactReporter?.id,
    };
  }

  // 3 sub-agent run 각각 1 evidence — 합성 chain 의 audit log 역할.
  // EvidenceRecord.sourceId 가 single string 이므로 run id 별 1 record (review omc:critic 지적).
  private toEvidence(
    refs: SubAgentRunRefs,
  ): { sourceType: string; sourceId: string; payload: unknown }[] {
    const evidence: {
      sourceType: string;
      sourceId: string;
      payload: unknown;
    }[] = [];
    if (refs.workReviewerRunId !== undefined) {
      evidence.push({
        sourceType: 'PO_EVAL_SOURCE_WORK_REVIEWER',
        sourceId: String(refs.workReviewerRunId),
        payload: { agentType: AgentType.WORK_REVIEWER },
      });
    }
    if (refs.poShadowRunId !== undefined) {
      evidence.push({
        sourceType: 'PO_EVAL_SOURCE_PO_SHADOW',
        sourceId: String(refs.poShadowRunId),
        payload: { agentType: AgentType.PO_SHADOW },
      });
    }
    if (refs.impactReporterRunId !== undefined) {
      evidence.push({
        sourceType: 'PO_EVAL_SOURCE_IMPACT_REPORTER',
        sourceId: String(refs.impactReporterRunId),
        payload: { agentType: AgentType.IMPACT_REPORTER },
      });
    }
    return evidence;
  }
}

const buildPrompt = ({
  snapshots,
  range,
}: {
  snapshots: SubAgentSnapshots;
  range: AgentRunRange;
}): string => {
  const lines: string[] = [`[range] ${range}`, ''];
  pushSection(lines, 'Work Reviewer 직전 output', snapshots.workReviewer);
  pushSection(lines, 'PO Shadow 직전 output', snapshots.poShadow);
  pushSection(lines, 'Impact Reporter 직전 output', snapshots.impactReporter);
  lines.push('');
  lines.push('[합성 지시]');
  lines.push(
    '위 sub-agent 결과 (일부 누락 가능) 를 통합해 qualitative + careerLog 를 system prompt schema 대로 작성하라.',
  );
  return lines.join('\n');
};

const pushSection = (
  lines: string[],
  label: string,
  snapshot: SucceededAgentRunSnapshot | null,
): void => {
  if (!snapshot) {
    lines.push(`[${label}] (없음 — sub-agent 미실행)`);
    lines.push('');
    return;
  }
  lines.push(
    `[${label}] (runId=${snapshot.id}, endedAt=${snapshot.endedAt.toISOString()})`,
  );
  const serialized = serializeOutput(snapshot.output);
  lines.push(truncateUtf8(serialized, MAX_SUB_AGENT_OUTPUT_BYTES));
  lines.push('');
};

const serializeOutput = (output: unknown): string => {
  if (typeof output === 'string') {
    return output;
  }
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
};

// UTF-8 byte 기준 tail truncate — multi-byte 경계 깨짐 방지 (slack-inbox.service 패턴).
const truncateUtf8 = (text: string, maxBytes: number): string => {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.byteLength <= maxBytes) {
    return text;
  }
  const suffixBytes = Buffer.byteLength(TRUNCATE_SUFFIX, 'utf8');
  const target = Math.max(0, maxBytes - suffixBytes);
  const sliced = buffer.subarray(0, target).toString('utf8').replace(/�$/, '');
  return `${sliced}${TRUNCATE_SUFFIX}`;
};
