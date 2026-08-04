import { Injectable } from '@nestjs/common';

import { LocalSessionService } from '../../local-sessions/application/local-session.service';
import { LocalSession } from '../../local-sessions/domain/local-session.type';
import {
  CiFailureInstructionParams,
  injectInstructionForCiFailure,
  injectInstructionForPr,
} from '../domain/inject-instruction';
import { repoFromCwd } from '../domain/repo-from-cwd';
import {
  IdleSession,
  SessionDispatchService,
} from './session-dispatch.service';

export interface CiFailureEvent {
  readonly repo: string;
  readonly checkName: string;
  readonly headSha: string;
  readonly htmlUrl: string;
}

export interface PrOpenedEvent {
  readonly repo: string;
  readonly prNumber: number;
  readonly title: string;
}

@Injectable()
export class GithubEventBridge {
  constructor(
    private readonly dispatch: SessionDispatchService,
    private readonly localSessions: LocalSessionService,
  ) {}

  async onPrOpened(event: PrOpenedEvent): Promise<void> {
    const session = this.findIdleClaudeSessionForRepo(event.repo);
    if (!session) {
      return;
    }
    const prRef = `${event.repo}#${event.prNumber}`;
    await this.dispatch.offerToIdleSession({
      session,
      prRef,
      instruction: injectInstructionForPr(prRef),
      previewText: `PR ${prRef}(${event.title})가 열렸습니다. 세션 ${session.name}에 리뷰를 맡길까요?`,
    });
  }

  async onCiFailure(event: CiFailureEvent): Promise<void> {
    const session = this.findIdleClaudeSessionForRepo(event.repo);
    if (!session) {
      return;
    }
    const shortSha = event.headSha.slice(0, 7);
    // checkName 을 키에 넣는다 — prRef 는 중복 제안 차단 키로도 쓰이므로, 같은 커밋의
    // 서로 다른 체크 실패는 서로 다른 작업으로 구분돼야 한다. 커밋만으로 묶으면
    // 첫 체크 실패 카드가 나머지 체크의 제안을 영구히 막는다.
    const prRef = `${event.repo}@${shortSha}#${event.checkName}`;
    const params: CiFailureInstructionParams = {
      repo: event.repo,
      checkName: event.checkName,
      headSha: event.headSha,
      htmlUrl: event.htmlUrl,
    };
    await this.dispatch.offerToIdleSession({
      session,
      prRef,
      instruction: injectInstructionForCiFailure(params),
      previewText: `${event.repo}의 CI 체크 "${event.checkName}"가 실패했습니다. 세션 ${session.name}에 수정을 맡길까요?`,
    });
  }

  private findIdleClaudeSessionForRepo(
    repoFullName: string,
  ): IdleSession | null {
    if (!this.dispatch.isEnabled()) {
      return null;
    }
    const repoName = repoFullName.split('/').pop();
    if (!repoName) {
      return null;
    }
    const candidates = this.localSessions
      .list()
      .filter(
        (session: LocalSession) =>
          session.state === 'idle' &&
          session.source === 'claude' &&
          repoFromCwd(session.cwd) === repoName,
      );
    if (candidates.length === 0) {
      return null;
    }
    candidates.sort(
      (a, b) =>
        (b.lastActivityAt?.getTime() ?? 0) - (a.lastActivityAt?.getTime() ?? 0),
    );
    const picked = candidates[0];
    return {
      sessionId: picked.sessionId,
      source: picked.source,
      cwd: picked.cwd,
      name: picked.name,
    };
  }
}
