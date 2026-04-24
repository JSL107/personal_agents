import { Inject, Injectable, Logger } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
  PullRequestRef,
} from '../../../github/domain/port/github-client.port';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { parsePrReference } from '../../code-reviewer/domain/pr-reference.parser';
import { BeAgentException } from '../domain/be-agent.exception';
import { BackendPlan, GenerateBackendPlanInput } from '../domain/be-agent.type';
import { BeAgentErrorCode } from '../domain/be-agent-error-code.enum';
import { parseBackendPlan } from '../domain/prompt/backend-plan.parser';
import { BE_AGENT_SYSTEM_PROMPT } from '../domain/prompt/be-agent-system.prompt';

// PR body 가 길어 prompt 폭발하는 걸 막는 상한 (UTF-8 byte).
const PR_BODY_MAX_BYTES = 4_000;

@Injectable()
export class GenerateBackendPlanUsecase {
  private readonly logger = new Logger(GenerateBackendPlanUsecase.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
  ) {}

  async execute({
    subject,
    slackUserId,
  }: GenerateBackendPlanInput): Promise<BackendPlan> {
    const trimmed = subject.trim();
    if (trimmed.length === 0) {
      throw new BeAgentException({
        code: BeAgentErrorCode.EMPTY_SUBJECT,
        message:
          '분석 대상이 비어 있습니다. `/plan-task <PR 링크 / 작업 설명>` 형식으로 입력해주세요.',
        status: DomainStatus.BAD_REQUEST,
      });
    }

    // PR URL / owner/repo#N 패턴이면 GitHub detail 을 prompt 에 ground (Impact Reporter 와 동일 전략).
    // parsePrReference 는 "PR ref 만" 들어온 입력에만 매칭 — 자유 텍스트 혼합이면 throw → null.
    // 따라서 prRef !== null 이면 subject 에 task 설명이 없다는 뜻. fetch 실패 시 model 은
    // 근거 없이 plan 을 만들 수밖에 없으므로 (codex review bha25i79n P2) 명시 예외로 사용자에게 재입력 요청.
    const prRef = tryParsePrReference(trimmed);
    const prContext = prRef ? await this.fetchPrContextOrNull(prRef) : null;
    if (prRef && !prContext) {
      throw new BeAgentException({
        code: BeAgentErrorCode.PR_GROUNDING_REQUIRED,
        message: `PR (${prRef.repo}#${prRef.number}) 정보를 가져오지 못해 작업 내용을 알 수 없습니다. GITHUB_TOKEN 이 설정돼 있는지 / 해당 PR 에 접근 권한이 있는지 확인하거나, 작업 설명을 자유 텍스트로 입력해주세요.`,
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }
    const prompt = buildPrompt({ subject: trimmed, prContext });

    return this.agentRunService.execute({
      agentType: AgentType.BE,
      triggerType: TriggerType.SLACK_COMMAND_PLAN_TASK,
      inputSnapshot: {
        subject: trimmed,
        slackUserId,
        prGroundingAttempted: prRef !== null,
        prGroundingSucceeded: prContext !== null,
      },
      evidence: [
        {
          sourceType: 'SLACK_COMMAND_PLAN_TASK',
          sourceId: slackUserId,
          payload: { subject: trimmed },
        },
        ...(prContext
          ? [
              {
                sourceType: 'GITHUB_PR_DETAIL' as const,
                sourceId: `${prContext.repo}#${prContext.number}`,
                payload: {
                  title: prContext.title,
                  body: prContext.body,
                  url: prContext.url,
                },
              },
            ]
          : []),
      ],
      run: async () => {
        const completion = await this.modelRouter.route({
          agentType: AgentType.BE,
          request: { prompt, systemPrompt: BE_AGENT_SYSTEM_PROMPT },
        });
        const plan = parseBackendPlan(completion.text);
        return {
          result: plan,
          modelUsed: completion.modelUsed,
          output: plan,
        };
      },
    });
  }

  private async fetchPrContextOrNull(
    ref: PullRequestRef,
  ): Promise<PrContext | null> {
    try {
      const detail = await this.githubClient.getPullRequest(ref);
      return {
        repo: ref.repo,
        number: ref.number,
        title: detail.title,
        body: truncateUtf8(detail.body ?? '', PR_BODY_MAX_BYTES),
        url: detail.url,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `GitHub PR ${ref.repo}#${ref.number} 조회 실패 (자유 텍스트로 fallback): ${message}`,
      );
      return null;
    }
  }
}

interface PrContext {
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
}

const tryParsePrReference = (raw: string) => {
  try {
    return parsePrReference(raw);
  } catch {
    return null;
  }
};

const buildPrompt = ({
  subject,
  prContext,
}: {
  subject: string;
  prContext: PrContext | null;
}): string => {
  if (!prContext) {
    return subject;
  }
  return [
    '[분석 대상]',
    subject,
    '',
    `[GitHub PR ${prContext.repo}#${prContext.number}]`,
    `URL: ${prContext.url}`,
    `Title: ${prContext.title}`,
    '',
    'Body:',
    prContext.body.length > 0 ? prContext.body : '(본문 없음)',
  ].join('\n');
};

const truncateUtf8 = (text: string, maxBytes: number): string => {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.byteLength <= maxBytes) {
    return text;
  }
  const sliced = buffer
    .subarray(0, maxBytes)
    .toString('utf8')
    .replace(/�$/, '');
  return `${sliced}\n... (생략됨 — PR body cap ${maxBytes} bytes)`;
};
