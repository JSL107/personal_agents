import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BrokerHolding } from '../../domain/broker-holdings.type';
import { BrokerHoldingsPort } from '../../domain/port/broker-holdings.port';
import { TossApiClient } from './toss-api.client';
import { mapTossHoldingsResponse } from './toss-holdings.mapper';

interface AccountResponseItem {
  accountNo?: unknown;
  accountSeq?: unknown;
  accountType?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

@Injectable()
export class TossInvestClient implements BrokerHoldingsPort {
  constructor(
    private readonly tossApi: TossApiClient,
    private readonly configService: ConfigService,
  ) {}

  async fetchHoldings(): Promise<BrokerHolding[]> {
    const accountSequence = await this.getAccountSequence();
    const response = await this.tossApi.requestJson(
      '보유 종목 조회',
      '/api/v1/holdings',
      {
        headers: {
          'X-Tossinvest-Account': accountSequence,
        },
      },
    );
    const holdings = mapTossHoldingsResponse(response);
    if (!holdings) {
      throw new Error('토스증권 보유 종목 응답 형식이 올바르지 않습니다.');
    }
    return holdings;
  }

  private async getAccountSequence(): Promise<string> {
    const configuredSequence = this.configService
      .get<string>('TOSS_ACCOUNT_SEQ')
      ?.trim();
    if (configuredSequence) {
      if (!/^\d+$/.test(configuredSequence)) {
        throw new Error('TOSS_ACCOUNT_SEQ는 정수 문자열이어야 합니다.');
      }
      return configuredSequence;
    }

    const response = await this.tossApi.requestJson(
      '계좌 목록 조회',
      '/api/v1/accounts',
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

  // 실측(2026-08-06 첫 실호출) — `/accounts` 는 `result` 가 **배열 그 자체**다.
  //   { "result": [ { accountNo, accountSeq, accountType } ] }
  //
  // 같은 API 의 `/holdings` 는 `result` 가 객체이고 그 안에 `items` 배열이 있다.
  // 엔드포인트마다 형태가 다르므로 한쪽 규약을 다른 쪽에 유추해 적용하면 안 된다 —
  // 이 파서가 `result.items` 를 기대하고 있어 첫 실호출이 통째로 실패했다.
  private parseAccounts(raw: unknown): AccountResponseItem[] {
    if (isRecord(raw) && Array.isArray(raw.result)) {
      return raw.result.filter(isRecord) as AccountResponseItem[];
    }
    throw new Error('토스증권 계좌 목록 응답 형식이 올바르지 않습니다.');
  }
}
