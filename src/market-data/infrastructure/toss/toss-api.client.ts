import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const API_BASE_URL = 'https://openapi.tossinvest.com';
const TOKEN_REFRESH_BUFFER_MS = 60_000;
// Node 내장 fetch 는 응답이 오지 않아도 자체 기본값(수 분)까지 매달린다. 감시는 보유 종목을
// 순차 호출하므로 종목 수만큼 그 시간이 누적되고, 그러면 autopilot worker 의 lockDuration
// (`common/queue/worker-options.constant.ts`) 을 넘겨 BullMQ 가 같은 job 을 stalled 로 보고
// 재처리한다 — 이 레포가 이미 겪은 중복 실행 경로다.
// 실측 왕복이 83~118ms 라 15초는 정상 응답을 자르지 않는다.
const REQUEST_TIMEOUT_MS = 15_000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
}

export class TossApiHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TossApiHttpError';
  }
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
    try {
      return await this.requestJsonWithAccessToken(
        operation,
        path,
        init,
        accessToken,
      );
    } catch (error) {
      if (!(error instanceof TossApiHttpError) || error.status !== 401) {
        throw error;
      }

      this.cachedToken = null;
      const refreshedAccessToken = await this.getAccessToken();
      // 현재 호출부는 모두 GET 이라 init 을 그대로 재사용해도 안전하다. stream body 는 한 번
      // 소비하면 재사용할 수 없으므로, POST 등 body 가 있는 요청을 지원할 때는 별도 처리해야 한다.
      return await this.requestJsonWithAccessToken(
        operation,
        path,
        init,
        refreshedAccessToken,
      );
    }
  }

  private async requestJsonWithAccessToken(
    operation: string,
    path: string,
    init: RequestInit | undefined,
    accessToken: string,
  ): Promise<unknown> {
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
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        `토스증권 ${operation} 요청 실패: ${errorMessage(error)}`,
      );
    }
    if (!response.ok) {
      throw new TossApiHttpError(
        `토스증권 ${operation} 실패: HTTP ${response.status} ${response.statusText}`,
        response.status,
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
