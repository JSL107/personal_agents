import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { SucceededAgentRunSnapshot } from '../../../agent-run/domain/port/agent-run.repository.port';
import { AgentRunRange } from '../../../common/domain/agent-run-range.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { getTodayKstDate } from '../../../common/util/kst-date.util';
import { GithubPullRequestSummary } from '../../../github/domain/github.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { PoEvalException } from '../domain/po-eval.exception';
import {
  EvaluationInput,
  EvaluationOutput,
  MergedPrEvaluation,
  MergedPrReview,
  SubAgentRunRefs,
} from '../domain/po-eval.type';
import { PoEvalErrorCode } from '../domain/po-eval-error-code.enum';
import {
  LlmMergedPrReview,
  parseEvaluationOutput,
} from '../domain/prompt/evaluation.parser';
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
// 오늘 머지 PR 평가 — prompt 폭발 방지용 상한 (impact-reporter recent 모드와 동일 수치).
const MERGED_PR_LIMIT = 20;
const PR_BODY_MAX_BYTES = 1_500;

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
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    private readonly configService: ConfigService,
  ) {}

  async execute({
    slackUserId,
    range = 'WEEK',
    triggerType = TriggerType.SLACK_COMMAND_PO_EVAL,
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

    const mergedPrs = await this.collectTodayMergedPrs(range);

    return this.agentRunService.execute({
      agentType: AgentType.PO_EVAL,
      triggerType,
      inputSnapshot: {
        slackUserId,
        range,
        workReviewerRunId: refs.workReviewerRunId,
        poShadowRunId: refs.poShadowRunId,
        impactReporterRunId: refs.impactReporterRunId,
      },
      evidence: this.toEvidence(refs),
      run: async () => {
        const prompt = buildPrompt({ snapshots, range, mergedPrs });
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
          mergedPrReview: joinMergedPrReview(partial.mergedPrReview, mergedPrs),
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

  // range=TODAY + IMPACT_REPORT_GITHUB_AUTHOR 설정 시에만 오늘(KST) 머지된 본인 PR 수집.
  // GitHub 조회 실패는 빈 배열 — PR 평가만 빠지고 회고 합성은 그대로 진행 (graceful).
  private async collectTodayMergedPrs(
    range: AgentRunRange,
  ): Promise<GithubPullRequestSummary[]> {
    if (range !== 'TODAY') {
      return [];
    }
    const author = this.configService.get<string>(
      'IMPACT_REPORT_GITHUB_AUTHOR',
    );
    if (!author || author.trim().length === 0) {
      return [];
    }
    const repoEnv = this.configService.get<string>('IMPACT_REPORT_GITHUB_REPO');
    const repo = repoEnv && repoEnv.trim().length > 0 ? repoEnv : null;
    const today = getTodayKstDate();
    try {
      const summaries =
        await this.githubClient.listAuthorMergedPullRequestsSince({
          repo,
          author,
          sinceIsoDate: today,
          limit: MERGED_PR_LIMIT,
        });
      // GitHub merged:>= 는 UTC 기준이라 어제 늦은 밤(KST) 머지가 섞일 수 있어 KST 날짜 == 오늘 만.
      return summaries.filter(
        (summary) => toKstDate(summary.mergedAt) === today,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `오늘 머지 PR 조회 실패 (PR 평가 생략): ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }
}

const buildPrompt = ({
  snapshots,
  range,
  mergedPrs,
}: {
  snapshots: SubAgentSnapshots;
  range: AgentRunRange;
  mergedPrs: GithubPullRequestSummary[];
}): string => {
  const lines: string[] = [`[range] ${range}`, ''];
  pushSection(lines, 'Work Reviewer 직전 output', snapshots.workReviewer);
  pushSection(lines, 'PO Shadow 직전 output', snapshots.poShadow);
  pushSection(lines, 'Impact Reporter 직전 output', snapshots.impactReporter);
  if (mergedPrs.length > 0) {
    lines.push('[오늘 머지 PR] (각 PR 을 평가해 mergedPrReview 로 출력)');
    for (const pr of mergedPrs) {
      lines.push(
        `- #${pr.number} ${pr.repo}#${pr.number} — ${pr.title} (+${pr.additions}/-${pr.deletions}, ${pr.changedFilesCount} files)`,
      );
      const body = truncateUtf8(pr.body.trim(), PR_BODY_MAX_BYTES);
      if (body.length > 0) {
        lines.push(`  본문: ${body}`);
      }
    }
    lines.push('');
  }
  lines.push('[합성 지시]');
  lines.push(
    '위 sub-agent 결과 (일부 누락 가능) 를 통합해 qualitative + careerLog 를 system prompt schema 대로 작성하라.',
  );
  if (mergedPrs.length > 0) {
    lines.push(
      '[오늘 머지 PR] 이 있으면 각 PR 을 평가해 mergedPrReview (overall + prs[prNumber/evaluation]) 로 출력하라.',
    );
  }
  return lines.join('\n');
};

// LLM 이 만든 PR 평가(evaluation)를 GitHub PR 메타와 prNumber 로 join.
// PR 메타가 source-of-truth — evaluation 없는 PR 은 빈 문자열, LLM 이 만든 미존재 prNumber 는 버린다.
const joinMergedPrReview = (
  llm: LlmMergedPrReview | undefined,
  prs: GithubPullRequestSummary[],
): MergedPrReview | undefined => {
  if (prs.length === 0) {
    return undefined;
  }
  const evaluationByNumber = new Map<number, string>();
  for (const item of llm?.prs ?? []) {
    evaluationByNumber.set(item.prNumber, item.evaluation);
  }
  const joined: MergedPrEvaluation[] = prs.map((pr) => ({
    prNumber: pr.number,
    ref: `${pr.repo}#${pr.number}`,
    title: pr.title,
    url: pr.url,
    additions: pr.additions,
    deletions: pr.deletions,
    evaluation: evaluationByNumber.get(pr.number) ?? '',
  }));
  return { overall: llm?.overall ?? '', prs: joined };
};

// mergedAt(ISO, null 가능) → Asia/Seoul 날짜 (YYYY-MM-DD). null 이면 빈 문자열.
const toKstDate = (iso: string | null): string => {
  if (!iso) {
    return '';
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
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
