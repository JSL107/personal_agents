import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
  PullRequestRef,
} from '../../../github/domain/port/github-client.port';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { BeFixException } from '../domain/be-fix.exception';
import {
  AnalyzePrConventionInput,
  PrConventionReport,
} from '../domain/be-fix.type';
import { BeFixErrorCode } from '../domain/be-fix-error-code.enum';
import { parsePrConventionReport } from '../domain/prompt/be-fix.parser';
import { BE_FIX_SYSTEM_PROMPT } from '../domain/prompt/be-fix-system.prompt';

// diff 가 너무 크면 prompt cap 을 넘기므로 head 100KB 만 사용.
const DIFF_BYTE_CAP = 100_000;

// 지원 형식:
//   123              → number-only
//   #123             → hash-prefixed
//   owner/repo#123   → shorthand
//   https://github.com/owner/repo/pull/123
const URL_PATTERN =
  /^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)\/?$/;
const SHORTHAND_PATTERN = /^([^/\s]+\/[^/\s#]+)#(\d+)$/;
const NUMBER_PATTERN = /^#?(\d+)$/;

@Injectable()
export class AnalyzePrConventionUsecase {
  private readonly logger = new Logger(AnalyzePrConventionUsecase.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
  ) {}

  async execute({
    prRef,
    slackUserId,
    triggerType,
  }: AnalyzePrConventionInput): Promise<AgentRunOutcome<PrConventionReport>> {
    const trimmed = prRef.trim();

    if (trimmed.length === 0) {
      throw new BeFixException({
        code: BeFixErrorCode.EMPTY_PR_REF,
        message:
          'PR 참조가 비어 있습니다. `/be-fix <PR번호>` 또는 `/be-fix owner/repo#123` 형식으로 입력해주세요.',
        status: DomainStatus.BAD_REQUEST,
      });
    }

    const ref = parsePrRef(trimmed);
    if (!ref) {
      throw new BeFixException({
        code: BeFixErrorCode.INVALID_PR_REF,
        message: `PR 참조 형식이 잘못되었습니다: "${trimmed}". 예: \`/be-fix 123\` 또는 \`/be-fix owner/repo#123\` 또는 \`/be-fix https://github.com/owner/repo/pull/123\`.`,
        status: DomainStatus.BAD_REQUEST,
      });
    }

    // GITHUB_PR evidence 는 PR fetch 후 확정되므로 run 콜백 안에서 recordEvidence 를 직접 호출할 수
    // 없다. AgentRunService.execute 의 evidence 배열은 run 전에 기록되므로, PR 메타는 run 후 별도
    // 로 넣지 않고 inputSnapshot 에만 포함한다 (MVP scope).
    return this.agentRunService.execute({
      agentType: AgentType.BE_FIX,
      triggerType: triggerType ?? TriggerType.SLACK_COMMAND_BE_FIX,
      inputSnapshot: {
        prRef: trimmed,
        repo: ref.repo,
        pullNumber: ref.number,
        slackUserId,
      },
      evidence: [
        {
          sourceType: 'SLACK_COMMAND_BE_FIX',
          sourceId: slackUserId,
          payload: { prRef: trimmed },
        },
      ],
      run: async () => {
        const [detail, diff] = await Promise.all([
          this.githubClient.getPullRequest(ref).catch((err: unknown) => {
            throw new BeFixException({
              code: BeFixErrorCode.PR_FETCH_FAILED,
              message: `PR 정보 조회에 실패했습니다: ${err instanceof Error ? err.message : String(err)}`,
              status: DomainStatus.BAD_GATEWAY,
              cause: err,
            });
          }),
          this.githubClient
            .getPullRequestDiff({ ...ref, maxBytes: DIFF_BYTE_CAP })
            .catch((err: unknown) => {
              throw new BeFixException({
                code: BeFixErrorCode.PR_FETCH_FAILED,
                message: `PR diff 조회에 실패했습니다: ${err instanceof Error ? err.message : String(err)}`,
                status: DomainStatus.BAD_GATEWAY,
                cause: err,
              });
            }),
        ]);

        const diffBytes = Buffer.byteLength(diff.diff, 'utf8');
        const diffTruncated = diff.truncated;

        const prompt = buildBeFixPrompt({
          prRef: trimmed,
          detail,
          diffText: diff.diff,
          diffTruncated,
        });

        const completion = await this.modelRouter.route({
          agentType: AgentType.BE_FIX,
          request: { prompt, systemPrompt: BE_FIX_SYSTEM_PROMPT },
        });

        const parsed = parsePrConventionReport(completion.text);

        // server-injected 필드 덮어씀 — LLM 의 echo 신뢰 안 함.
        const report: PrConventionReport = {
          ...parsed,
          prRef: trimmed,
          prTitle: detail.title,
          baseSha: detail.baseRef,
          headSha: detail.headRef,
          diffByteLength: diffBytes,
          diffTruncated,
        };

        this.logger.log(
          `BE-Fix ${trimmed}: ${report.violations.length}건 위반 발견 (parseError=${report.parseError ?? false})`,
        );

        return {
          result: report,
          modelUsed: completion.modelUsed,
          output: report as unknown as Record<string, unknown>,
        };
      },
    });
  }
}

const parsePrRef = (raw: string): PullRequestRef | null => {
  const urlMatch = raw.match(URL_PATTERN);
  if (urlMatch) {
    return { repo: urlMatch[1], number: Number.parseInt(urlMatch[2], 10) };
  }

  const shortMatch = raw.match(SHORTHAND_PATTERN);
  if (shortMatch) {
    return { repo: shortMatch[1], number: Number.parseInt(shortMatch[2], 10) };
  }

  const numMatch = raw.match(NUMBER_PATTERN);
  if (numMatch) {
    // number-only: repo 는 빈 문자열로 — GithubClientPort 구현이 GITHUB_REPO 환경변수로 채워야 함.
    // 현재 MVP scope 에서는 owner/repo#N 또는 URL 형식 사용을 권장.
    return { repo: '', number: Number.parseInt(numMatch[1], 10) };
  }

  return null;
};

const buildBeFixPrompt = ({
  prRef,
  detail,
  diffText,
  diffTruncated,
}: {
  prRef: string;
  detail: {
    title: string;
    repo: string;
    number: number;
    authorLogin: string;
    baseRef: string;
    headRef: string;
    additions: number;
    deletions: number;
  };
  diffText: string;
  diffTruncated: boolean;
}): string => {
  const diffNote = diffTruncated
    ? `\n(diff 가 ${DIFF_BYTE_CAP} bytes 를 초과하여 앞부분만 전달됨)`
    : '';

  return [
    '[PR 메타]',
    `- ref: ${prRef}`,
    `- repo: ${detail.repo}`,
    `- number: #${detail.number}`,
    `- title: ${detail.title}`,
    `- author: ${detail.authorLogin}`,
    `- branch: ${detail.headRef} → ${detail.baseRef}`,
    `- additions/deletions: +${detail.additions} / -${detail.deletions}`,
    '',
    `[diff]${diffNote}`,
    '```diff',
    diffText,
    '```',
  ].join('\n');
};
