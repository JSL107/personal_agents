import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import {
  ResolvedLatestOpenPr,
  resolveLatestOpenPrRef,
} from '../../../github/application/resolve-latest-open-pr';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatPrConventionReport } from '../../../slack/format/be-fix.formatter';
import { AnalyzePrConventionUsecase } from '../application/analyze-pr-convention.usecase';
import { BeFixException } from '../domain/be-fix.exception';
import { BeFixErrorCode } from '../domain/be-fix-error-code.enum';
import { isValidBeFixPrRef } from '../domain/be-fix-pr-ref.parser';

const AUTO_RESOLVE_LOOKBACK_DAYS = 180;

// BE_FIX worker 의 Router dispatcher — 자연어 메시지 (`input.text`) 를 prRef 로 매핑.
@Injectable()
export class BeFixDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.BE_FIX;

  constructor(
    private readonly analyzePrConvention: AnalyzePrConventionUsecase,
    private readonly config: ConfigService,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    let prRef = input.text ?? '';
    let autoResolvedNotice: string | undefined;

    if (input.source === 'REMOTE_CONSOLE' && !isValidBeFixPrRef(prRef.trim())) {
      const resolved = await this.resolveLatestOpenPrOrThrow();
      if (resolved) {
        prRef = resolved.prRef;
        autoResolvedNotice = resolved.notice;
      }
    }

    const outcome = await this.analyzePrConvention.execute({
      prRef,
      slackUserId: input.slackUserId,
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: formatPrConventionReport(outcome.result),
      ...(autoResolvedNotice !== undefined ? { autoResolvedNotice } : {}),
    };
  }

  private async resolveLatestOpenPrOrThrow(): Promise<ResolvedLatestOpenPr | null> {
    const author = this.config.get<string>('IMPACT_REPORT_GITHUB_AUTHOR');
    if (!author) {
      return null;
    }

    const repoEnv = this.config.get<string>('IMPACT_REPORT_GITHUB_REPO');
    const repo = repoEnv && repoEnv.trim().length > 0 ? repoEnv : null;
    const sinceIsoDate = new Date(
      Date.now() - AUTO_RESOLVE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    const resolved = await resolveLatestOpenPrRef(this.githubClient, {
      author,
      repo,
      sinceIsoDate,
    });
    if (!resolved) {
      throw new BeFixException({
        code: BeFixErrorCode.NO_OPEN_PR_FOUND,
        message: `수정할 PR 을 지정하지 않았고, 최근 ${AUTO_RESOLVE_LOOKBACK_DAYS}일 안에 열려있는 PR 도 없습니다. PR 링크(owner/repo#N)를 함께 지시해주세요.`,
        status: DomainStatus.NOT_FOUND,
      });
    }

    return resolved;
  }
}
