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

interface OpenPreviewTarget {
  readonly sessionId: string;
  readonly prRef: string;
}

@Injectable()
export class SessionDispatchService {
  private readonly logger = new Logger(SessionDispatchService.name);
  // 제안 생성이 진행 중인 prRef — 열린 preview 조회와 생성 사이의 check-then-act 경쟁을 막는다.
  // SessionPoller 는 한 tick 의 idle 전이를 연속 발행하고 watcher 는 await 없이 발사하므로,
  // 같은 작업에 대한 호출이 동시에 조회를 통과할 수 있다. 단일 프로세스 전제 —
  // 멀티 인스턴스로 가면 DB 수준 제약이 필요하다.
  private readonly inFlightPrRefs = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    private readonly createPreview: CreatePreviewUsecase,
    private readonly findAllOpenPreviews: FindAllOpenPreviewsUsecase,
    private readonly cooldown: DispatchCooldown,
    private readonly resolveRepo: (cwd: string) => string | null,
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
    if (this.inFlightPrRefs.has(params.prRef)) {
      return false;
    }
    // 검사와 등록 사이에 await 가 없어 단일 스레드에서 원자적이다.
    this.inFlightPrRefs.add(params.prRef);
    try {
      const openPreviews = await this.findAllOpenPreviews.execute({});
      if (
        this.hasBlockingOpenPreview(openPreviews, {
          sessionId: session.sessionId,
          prRef: params.prRef,
        })
      ) {
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
    } finally {
      this.inFlightPrRefs.delete(params.prRef);
    }
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
      const repository = this.resolveRepo(session.cwd);
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

  // 같은 세션에 대한 중복 제안뿐 아니라, 같은 작업(prRef)을 여러 유휴 세션에 동시 제안하는
  // fan-out 도 막는다 — 작업 하나당 승인/거절 카드 한 장이 되도록.
  private hasBlockingOpenPreview(
    previews: PreviewAction[],
    target: OpenPreviewTarget,
  ): boolean {
    return previews.some((preview) => {
      if (preview.kind !== PREVIEW_KIND.SESSION_INJECT) {
        return false;
      }

      if (!preview.payload || typeof preview.payload !== 'object') {
        return false;
      }

      const payload = preview.payload as Partial<SessionInjectPreviewPayload>;
      return (
        payload.sessionId === target.sessionId || payload.prRef === target.prRef
      );
    });
  }

  private getOpenPullRequestSinceIsoDate(): string {
    const lookbackMs = OPEN_PULL_REQUEST_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    const date = new Date(Date.now() - lookbackMs);
    return date.toISOString().slice(0, 10);
  }
}
