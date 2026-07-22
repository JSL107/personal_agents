import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BrokerHolding } from '../../domain/broker-holdings.type';
import { BrokerHoldingsPort } from '../../domain/port/broker-holdings.port';
import { mapTossHoldingsResponse } from './toss-holdings.mapper';

const API_BASE_URL = 'https://openapi.tossinvest.com';
const TOKEN_REFRESH_BUFFER_MS = 60_000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
}

interface AccountResponseItem {
  accountNo?: unknown;
  accountSeq?: unknown;
  accountType?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const errorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

@Injectable()
export class TossInvestClient implements BrokerHoldingsPort {
  private cachedToken: CachedToken | null = null;

  constructor(private readonly configService: ConfigService) {}

  async fetchHoldings(): Promise<BrokerHolding[]> {
    const accessToken = await this.getAccessToken();
    const accountSequence = await this.getAccountSequence(accessToken);
    const response = await this.requestJson(
      `${API_BASE_URL}/api/v1/holdings`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Tossinvest-Account': accountSequence,
        },
      },
      '보유 종목 조회',
    );
    const holdings = mapTossHoldingsResponse(response);
    if (!holdings) {
      throw new Error('토스증권 보유 종목 응답 형식이 올바르지 않습니다.');
    }
    return holdings;
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
    const response = await this.requestJson(
      `${API_BASE_URL}/oauth2/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
      '토큰 발급',
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

  private async getAccountSequence(accessToken: string): Promise<string> {
    const configuredSequence = this.configService
      .get<string>('TOSS_ACCOUNT_SEQ')
      ?.trim();
    if (configuredSequence) {
      if (!/^\d+$/.test(configuredSequence)) {
        throw new Error('TOSS_ACCOUNT_SEQ는 정수 문자열이어야 합니다.');
      }
      return configuredSequence;
    }

    const response = await this.requestJson(
      `${API_BASE_URL}/api/v1/accounts`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      '계좌 목록 조회',
    );
    const accounts = this.parseAccounts(response);
    const brokerageAccount = accounts.find(
      (account) => account.accountType === 'BROKERAGE',
    );
    if (!brokerageAccount || !Number.isInteger(brokerageAccount.accountSeq)) {
      throw new Error('토스증권 BROKERAGE 계좌를 찾을 수 없습니다.');
    }
    return String(brokerageAccount.accountSeq);
  }

  private parseAccounts(raw: unknown): AccountResponseItem[] {
    if (Array.isArray(raw)) {
      return raw.filter(isRecord) as AccountResponseItem[];
    }
    if (
      isRecord(raw) &&
      isRecord(raw.result) &&
      Array.isArray(raw.result.items)
    ) {
      return raw.result.items.filter(isRecord) as AccountResponseItem[];
    }
    throw new Error('토스증권 계좌 목록 응답 형식이 올바르지 않습니다.');
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    operation: string,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw new Error(
        `토스증권 ${operation} 요청 실패: ${errorMessage(error)}`,
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
