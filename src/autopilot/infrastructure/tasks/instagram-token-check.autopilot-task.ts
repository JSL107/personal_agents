import { Inject, Injectable } from '@nestjs/common';

import { toInstagramError } from '../../../instagram/domain/instagram.exception';
import { InstagramErrorCode } from '../../../instagram/domain/instagram-error-code.enum';
import {
  META_GRAPH_PORT,
  MetaGraphPort,
  PageTokenDebug,
} from '../../../instagram/domain/port/meta-graph.port';
import {
  AutopilotTask,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_INVALID_TEXT =
  '⚠️ 인스타 토큰이 무효입니다. 릴스 게시가 멈춥니다. README 「인스타 토큰 재동의」 절을 따라 다시 발급해 주세요.';

const INSIGHTS_SCOPE_MISSING_TEXT =
  '⚠️ 인스타 인사이트 권한(instagram_manage_insights)이 빠졌습니다. 릴스 성과 수집이 멈춥니다. README 「인스타 토큰 재동의」 절을 따라 다시 발급해 주세요.';

@Injectable()
export class InstagramTokenCheckAutopilotTask implements AutopilotTask {
  readonly id = 'instagram-token-check';
  readonly warnWithinMs = 14 * DAY_MS;

  constructor(@Inject(META_GRAPH_PORT) private readonly graph: MetaGraphPort) {}

  async run(): Promise<AutopilotTaskResult> {
    if (!this.graph.isConfigured()) {
      return { skip: true };
    }

    let token;
    try {
      token = await this.graph.debugPageToken();
    } catch (error) {
      if (toInstagramError({ error, code: InstagramErrorCode.TOKEN_INVALID })) {
        return { skip: false, summaryText: TOKEN_INVALID_TEXT };
      }
      throw error;
    }

    if (!token.isValid) {
      return { skip: false, summaryText: TOKEN_INVALID_TEXT };
    }
    if (!token.scopes.includes('instagram_content_publish')) {
      return {
        skip: false,
        summaryText:
          '⚠️ 인스타 게시 권한(instagram_content_publish)이 빠졌습니다.',
      };
    }
    // 만료는 게시를 멈추므로 먼저 적고, 인사이트 권한 누락(수집만 멈춤)은 뒤에 덧붙인다.
    const warnings: string[] = [];
    const expiry = this.expiryWarning(token);
    if (expiry) {
      warnings.push(expiry);
    }
    if (!token.scopes.includes('instagram_manage_insights')) {
      warnings.push(INSIGHTS_SCOPE_MISSING_TEXT);
    }
    if (warnings.length === 0) {
      return { skip: true };
    }
    return { skip: false, summaryText: warnings.join('\n') };
  }

  private expiryWarning(token: PageTokenDebug): string | null {
    // expires_at 0 은 "만료 없음" 이다. 0 이 아니면 데이터 접근 만료와 둘 중 먼저 오는 쪽이 게시를 멈춘다.
    const expiresAtMs =
      Math.min(
        ...[token.expiresAt, token.dataAccessExpiresAt].filter(
          (seconds) => seconds > 0,
        ),
      ) * 1000;
    const remainingMs = expiresAtMs - Date.now();
    if (remainingMs > this.warnWithinMs) {
      return null;
    }
    const days = Math.ceil(remainingMs / DAY_MS);
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(expiresAtMs));
    return `⏳ 인스타 토큰 재동의 D-${days} (${date}). README 「인스타 토큰 재동의」 절을 따라 갱신해 주세요.`;
  }
}
