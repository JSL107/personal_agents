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
import { repoFromCwd } from '../domain/repo-from-cwd';
import { DispatchCooldown } from './dispatch-cooldown';

const OPEN_PULL_REQUEST_LOOKBACK_DAYS = 180;
const SESSION_INJECT_PREVIEW_TTL_MS = 30 * 60 * 1000;

export interface IdleSession {
  readonly sessionId: string;
  readonly source: 'claude' | 'codex';
  readonly cwd: string;
  readonly name: string;
}

interface OfferParams {
  readonly session: IdleSession;
  readonly prRef: string;
  readonly instruction: string;
  readonly previewText: string;
}

interface DispatchGate {
  readonly ownerSlackUserId: string;
  readonly githubAuthor: string;
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
  ) {}

  private resolveGate(): DispatchGate | null {
    const ownerSlackUserId = this.readNonEmpty('AUTOPILOT_OWNER_SLACK_USER_ID');
    const githubAuthor = this.readNonEmpty('IMPACT_REPORT_GITHUB_AUTHOR');
    const enabled = this.config.get<string>('SESSION_DISPATCH_ENABLED');
    if (enabled !== 'true' || !ownerSlackUserId || !githubAuthor) {
      return null;
    }
    return { ownerSlackUserId, githubAuthor };
  }

  isEnabled(): boolean {
    return this.resolveGate() !== null;
  }

  async offerToIdleSession(params: OfferParams): Promise<boolean> {
    const gate = this.resolveGate();
    if (!gate) {
      return false;
    }
    const { session } = params;
    if (session.source !== 'claude') {
      return false;
    }
    if (this.cooldown.shouldSkip(session.sessionId)) {
      return false;
    }
    const openPreviews = await this.findAllOpenPreviews.execute({});
    if (this.hasOpenSessionInjectPreview(openPreviews, session.sessionId)) {
      return false;
    }
    const payload: SessionInjectPreviewPayload = {
      sessionId: session.sessionId,
      source: session.source,
      instruction: params.instruction,
      prRef: params.prRef,
    };
    await this.createPreview.execute({
      slackUserId: gate.ownerSlackUserId,
      kind: PREVIEW_KIND.SESSION_INJECT,
      payload,
      previewText: params.previewText,
      responseUrl: null,
      ttlMs: SESSION_INJECT_PREVIEW_TTL_MS,
    });
    this.cooldown.mark(session.sessionId);
    return true;
  }

  async onSessionBecameIdle(session: IdleSession): Promise<void> {
    try {
      const gate = this.resolveGate();
      if (!gate) {
        return;
      }
      if (session.source !== 'claude') {
        return;
      }
      if (this.cooldown.shouldSkip(session.sessionId)) {
        return;
      }
      const repository = repoFromCwd(session.cwd);
      if (!repository) {
        return;
      }
      const repositoryRef = `${gate.githubAuthor}/${repository}`;
      const resolvedPullRequest = await resolveLatestOpenPrRef(
        this.githubClient,
        {
          author: gate.githubAuthor,
          repo: repositoryRef,
          sinceIsoDate: this.getOpenPullRequestSinceIsoDate(),
        },
      );
      if (!resolvedPullRequest) {
        return;
      }
      await this.offerToIdleSession({
        session,
        prRef: resolvedPullRequest.prRef,
        instruction: injectInstructionForPr(resolvedPullRequest.prRef),
        previewText: `세션 ${session.name}(${repository})가 유휴 상태입니다. PR ${resolvedPullRequest.prRef} 리뷰를 맡길까요?`,
      });
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
