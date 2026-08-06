import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const API_BASE_URL = 'https://openapi.tossinvest.com';
const TOKEN_REFRESH_BUFFER_MS = 60_000;
// 실측(2026-08-06) — 한도는 초 단위 윈도우다(MARKET_DATA_CHART 5회/초). 1초 쉬면 리셋된다.
// 보유 6종목 조회 중 한 번 429 를 맞았고, 그때 그 종목은 그날 감시에서 통째로 빠졌다.
// 잔고 동기화 cron 이 붙으면 같은 계정을 두 워커가 쓰게 되어 경쟁이 더 늘어난다.
const RATE_LIMIT_RETRY_DELAY_MS = 1_000;
const RATE_LIMIT_STATUS = 429;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const errorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

@Injectable()
export class TossApiClient {
  private cachedToken: CachedToken | null = null;

  constructor(private readonly configService: ConfigService) {}

  async requestJson(
    operation: string,
    path: string,
    init?: RequestInit,
  ): Promise<unknown> {
    const accessToken = await this.getAccessToken();
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    return await this.requestJsonWithoutAuthentication(operation, path, {
      ...init,
      headers,
    });
  }

  private async getAccessToken(): Promise<string> {
    if (
      this.cachedToken &&
      Date.now() < this.cachedToken.expiresAt - TOKEN_REFRESH_BUFFER_MS
    ) {
      return this.cachedToken.accessToken;
    }

    const clientId = this.configService.get<string>('TOSS_CLIENT_ID')?.trim();
    const clientSecret = this.configService
      .get<string>('TOSS_CLIENT_SECRET')
      ?.trim();
    if (!clientId || !clientSecret) {
      throw new Error(
        '토스증권 잔고 동기화가 비활성 상태입니다. TOSS_CLIENT_ID와 TOSS_CLIENT_SECRET을 설정하세요.',
      );
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
    const response = await this.requestJsonWithoutAuthentication(
      '토큰 발급',
      '/oauth2/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
    );
    const token = this.parseTokenResponse(response);
    this.cachedToken = token;
    return token.accessToken;
  }

  private parseTokenResponse(raw: unknown): CachedToken {
    if (!isRecord(raw)) {
      throw new Error('토스증권 토큰 응답 형식이 올바르지 않습니다.');
    }
    const response = raw as TokenResponse;
    if (
      typeof response.access_token !== 'string' ||
      response.token_type !== 'Bearer' ||
      typeof response.expires_in !== 'number' ||
      !Number.isFinite(response.expires_in) ||
      response.expires_in <= 0
    ) {
      throw new Error('토스증권 토큰 응답 형식이 올바르지 않습니다.');
    }
    return {
      accessToken: response.access_token,
      expiresAt: Date.now() + response.expires_in * 1_000,
    };
  }

  private async requestJsonWithoutAuthentication(
    operation: string,
    path: string,
    init: RequestInit,
    retryOnRateLimit = true,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, init);
    } catch (error) {
      throw new Error(
        `토스증권 ${operation} 요청 실패: ${errorMessage(error)}`,
      );
    }
    // 재시도는 여기 한 곳에만 둔다. 모든 토스 호출이 이 경로를 지나므로
    // 호출부마다 같은 대응을 반복하지 않는다.
    if (response.status === RATE_LIMIT_STATUS && retryOnRateLimit) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS);
      });
      return await this.requestJsonWithoutAuthentication(
        operation,
        path,
        init,
        false,
      );
    }
    if (!response.ok) {
      throw new Error(
        `토스증권 ${operation} 실패: HTTP ${response.status} ${response.statusText}`,
      );
    }
    try {
      return await response.json();
    } catch (error) {
      throw new Error(
        `토스증권 ${operation} 응답 JSON 파싱 실패: ${errorMessage(error)}`,
      );
    }
  }
}
