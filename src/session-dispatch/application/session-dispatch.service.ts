import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { resolveLatestOpenPrRef } from '../../github/application/resolve-latest-open-pr';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../github/domain/port/github-client.port';
import { CreatePreviewUsecase } from '../../preview-gate/application/create-preview.usecase';
import { FindAllOpenPreviewsUsecase } from '../../preview-gate/application/find-all-open-previews.usecase';
import {
  PREVIEW_KIND,
  type PreviewAction,
  type SessionInjectPreviewPayload,
} from '../../preview-gate/domain/preview-action.type';
import { injectInstructionForPr } from '../domain/inject-instruction';
import { DispatchCooldown } from './dispatch-cooldown';

const OPEN_PULL_REQUEST_LOOKBACK_DAYS = 180;
const SESSION_INJECT_PREVIEW_TTL_MS = 30 * 60 * 1000;

interface IdleSession {
  sessionId: string;
  source: 'claude' | 'codex';
  cwd: string;
  name: string;
}

@Injectable()
export class SessionDispatchService {
  private readonly logger = new Logger(SessionDispatchService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    private readonly createPreview: CreatePreviewUsecase,
    private readonly findAllOpenPreviews: FindAllOpenPreviewsUsecase,
    private readonly cooldown: DispatchCooldown,
    private readonly resolveRepo: (cwd: string) => string | null,
  ) {}

  async onSessionBecameIdle(session: IdleSession): Promise<void> {
    try {
      const ownerSlackUserId = this.readNonEmpty(
        'AUTOPILOT_OWNER_SLACK_USER_ID',
      );
      const githubAuthor = this.readNonEmpty('IMPACT_REPORT_GITHUB_AUTHOR');
      const enabled = this.config.get<string>('SESSION_DISPATCH_ENABLED');
      if (enabled !== 'true' || !ownerSlackUserId || !githubAuthor) {
        return;
      }

      if (session.source !== 'claude') {
        return;
      }

      if (this.cooldown.shouldSkip(session.sessionId)) {
        return;
      }

      const openPreviews = await this.findAllOpenPreviews.execute({});
      if (this.hasOpenSessionInjectPreview(openPreviews, session.sessionId)) {
        return;
      }

      const repository = this.resolveRepo(session.cwd);
      if (!repository) {
        return;
      }
      const repositoryRef = `${githubAuthor}/${repository}`;

      const resolvedPullRequest = await resolveLatestOpenPrRef(
        this.githubClient,
        {
          author: githubAuthor,
          repo: repositoryRef,
          sinceIsoDate: this.getOpenPullRequestSinceIsoDate(),
        },
      );
      if (!resolvedPullRequest) {
        return;
      }

      const payload: SessionInjectPreviewPayload = {
        sessionId: session.sessionId,
        source: session.source,
        instruction: injectInstructionForPr(resolvedPullRequest.prRef),
        prRef: resolvedPullRequest.prRef,
      };
      await this.createPreview.execute({
        slackUserId: ownerSlackUserId,
        kind: PREVIEW_KIND.SESSION_INJECT,
        payload,
        previewText: `세션 ${session.name}(${repository})가 유휴 상태입니다. PR ${resolvedPullRequest.prRef} 리뷰를 맡길까요?`,
        responseUrl: null,
        ttlMs: SESSION_INJECT_PREVIEW_TTL_MS,
      });
      this.cooldown.mark(session.sessionId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Session dispatch 제안 생성 실패 (sessionId=${session.sessionId}): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private readNonEmpty(key: string): string | null {
    const raw = this.config.get<string>(key);
    if (!raw) {
      return null;
    }

    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private hasOpenSessionInjectPreview(
    previews: PreviewAction[],
    sessionId: string,
  ): boolean {
    return previews.some((preview) => {
      if (preview.kind !== PREVIEW_KIND.SESSION_INJECT) {
        return false;
      }

      if (!preview.payload || typeof preview.payload !== 'object') {
        return false;
      }

      const payload = preview.payload as Partial<SessionInjectPreviewPayload>;
      return payload.sessionId === sessionId;
    });
  }

  private getOpenPullRequestSinceIsoDate(): string {
    const lookbackMs = OPEN_PULL_REQUEST_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    const date = new Date(Date.now() - lookbackMs);
    return date.toISOString().slice(0, 10);
  }
}
