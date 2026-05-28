import { Injectable, Logger } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { SucceededAgentRunSnapshot } from '../../../agent-run/domain/port/agent-run.repository.port';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { CeoException } from '../domain/ceo.exception';
import {
  MetaInput,
  MetaOutput,
  MetaRange,
  SourcePhaseRunRefs,
} from '../domain/ceo.type';
import { CeoErrorCode } from '../domain/ceo-error-code.enum';
import {
  CEO_META_SYSTEM_PROMPT,
  MAX_PHASE_OUTPUT_BYTES,
} from '../domain/prompt/ceo-system.prompt';
import { parseMetaOutput } from '../domain/prompt/meta.parser';

// V3 phase P5 Meta — PO_EVAL 직전 run (필수) + PM/CTO 최근 run (선택) 을 LLM 1회 (Claude) 로 합성
// → contextDriftReport + docsQualityReport + finalSummary.
//
// minimal 단계 — 컨텍스트 오염 알고리즘은 외부 선례 없어 별도 R&D plan 으로 보류 (CLAUDE.md §7).
// 본 turn 은 단순 LLM 추론. AgentRunModule + ModelRouterModule 만 import (phase module 의존 X).

const TRUNCATE_SUFFIX = '\n... (생략됨 — phase output cap)';
const WEEK_SINCE_DAYS = 7;
const TODAY_SINCE_DAYS = 1;

interface PhaseSnapshots {
  poEval: SucceededAgentRunSnapshot;
  pm: SucceededAgentRunSnapshot | null;
  cto: SucceededAgentRunSnapshot | null;
}

@Injectable()
export class GenerateCeoMetaUsecase {
  private readonly logger = new Logger(GenerateCeoMetaUsecase.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({
    slackUserId,
    range = 'WEEK',
  }: MetaInput): Promise<AgentRunOutcome<MetaOutput>> {
    const snapshots = await this.collectSnapshots({ slackUserId, range });
    const refs: SourcePhaseRunRefs = {
      poEvalRunId: snapshots.poEval.id,
      pmRunId: snapshots.pm?.id,
      ctoRunId: snapshots.cto?.id,
    };

    return this.agentRunService.execute({
      agentType: AgentType.CEO,
      triggerType: TriggerType.SLACK_COMMAND_CEO_REVIEW,
      inputSnapshot: {
        slackUserId,
        range,
        poEvalRunId: refs.poEvalRunId,
        pmRunId: refs.pmRunId,
        ctoRunId: refs.ctoRunId,
      },
      evidence: this.toEvidence(refs),
      run: async () => {
        const prompt = buildPrompt({ snapshots, range });
        const completion = await this.modelRouter.route({
          agentType: AgentType.CEO,
          request: { prompt, systemPrompt: CEO_META_SYSTEM_PROMPT },
        });
        const partial = parseMetaOutput(completion.text);
        const output: MetaOutput = {
          range,
          sourcePhaseRuns: refs,
          contextDriftReport: partial.contextDriftReport,
          docsQualityReport: partial.docsQualityReport,
          finalSummary: partial.finalSummary,
          schemaVersion: 1,
        };
        this.logger.log(
          `CEO meta 합성 완료 — range=${range} refs=poEval=${refs.poEvalRunId} pm=${refs.pmRunId ?? '-'} cto=${refs.ctoRunId ?? '-'}`,
        );
        return {
          result: output,
          modelUsed: completion.modelUsed,
          output,
        };
      },
    });
  }

  // range 별 sinceDays 분기 — TODAY 는 1, WEEK 는 7. limit=1 로 가장 최근만.
  // PO_EVAL 없으면 NO_PO_EVAL_RUN throw (CEO 의 hard requirement).
  private async collectSnapshots({
    slackUserId,
    range,
  }: {
    slackUserId: string;
    range: MetaRange;
  }): Promise<PhaseSnapshots> {
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
    const [poEval, pm, cto] = await Promise.all([
      fetchLatestInRange(AgentType.PO_EVAL),
      fetchLatestInRange(AgentType.PM),
      fetchLatestInRange(AgentType.CTO),
    ]);
    if (!poEval) {
      throw new CeoException({
        code: CeoErrorCode.NO_PO_EVAL_RUN,
        message:
          range === 'WEEK'
            ? '최근 7일 내 PO_EVAL 의 성공 run 이 없습니다. `/po-eval` 먼저 실행해주세요 — CEO 합성의 필수 입력입니다.'
            : '최근 24시간 내 PO_EVAL 의 성공 run 이 없습니다. range 를 week 로 늘리거나 `/po-eval` 을 실행해주세요.',
        status: DomainStatus.NOT_FOUND,
      });
    }
    return { poEval, pm, cto };
  }

  // PO_EVAL 1 + PM/CTO 선택 — EvidenceRecord.sourceId 가 single string 이라 phase 별 1 record.
  // 합성 chain 의 audit log 역할 (PO_EVAL 패턴 차용).
  private toEvidence(
    refs: SourcePhaseRunRefs,
  ): { sourceType: string; sourceId: string; payload: unknown }[] {
    const evidence: {
      sourceType: string;
      sourceId: string;
      payload: unknown;
    }[] = [
      {
        sourceType: 'CEO_META_SOURCE_PO_EVAL',
        sourceId: String(refs.poEvalRunId),
        payload: { agentType: AgentType.PO_EVAL },
      },
    ];
    if (refs.pmRunId !== undefined) {
      evidence.push({
        sourceType: 'CEO_META_SOURCE_PM',
        sourceId: String(refs.pmRunId),
        payload: { agentType: AgentType.PM },
      });
    }
    if (refs.ctoRunId !== undefined) {
      evidence.push({
        sourceType: 'CEO_META_SOURCE_CTO',
        sourceId: String(refs.ctoRunId),
        payload: { agentType: AgentType.CTO },
      });
    }
    return evidence;
  }
}

const buildPrompt = ({
  snapshots,
  range,
}: {
  snapshots: PhaseSnapshots;
  range: MetaRange;
}): string => {
  const lines: string[] = [`[range] ${range}`, ''];
  pushSection(lines, 'PO_EVAL 직전 output', snapshots.poEval);
  pushSection(lines, 'PM 직전 plan', snapshots.pm);
  pushSection(lines, 'CTO 직전 분배', snapshots.cto);
  lines.push('');
  lines.push('[합성 지시]');
  lines.push(
    '위 phase 결과 (PM/CTO 일부 누락 가능) 를 종합해 contextDriftReport + docsQualityReport + finalSummary 를 system prompt schema 대로 작성하라.',
  );
  return lines.join('\n');
};

const pushSection = (
  lines: string[],
  label: string,
  snapshot: SucceededAgentRunSnapshot | null,
): void => {
  if (!snapshot) {
    lines.push(`[${label}] (없음 — phase run 미존재)`);
    lines.push('');
    return;
  }
  lines.push(
    `[${label}] (runId=${snapshot.id}, endedAt=${snapshot.endedAt.toISOString()})`,
  );
  const serialized = serializeOutput(snapshot.output);
  lines.push(truncateUtf8(serialized, MAX_PHASE_OUTPUT_BYTES));
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

// UTF-8 byte 기준 tail truncate — multi-byte 경계 깨짐 방지 (PO_EVAL / slack-inbox.service 패턴).
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
