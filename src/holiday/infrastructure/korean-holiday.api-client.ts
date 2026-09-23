import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { KoreanHoliday } from '../domain/holiday.type';
import { parseHolidayResponse } from '../domain/parse-holiday-response';
import { KoreanHolidayClientPort } from '../domain/port/korean-holiday.client.port';

// 한국천문연구원 특일 정보 — 공휴일만 주는 오퍼레이션.
const ENDPOINT =
  'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';

// Node 의 fetch 에는 기본 타임아웃이 없다. 없으면 공공 API 가 느린 날 워커가 그대로 매달린다
// (`job-feed/infrastructure/http-constants.ts` 와 같은 이유). 한 달치 조회라 응답이 작다.
const REQUEST_TIMEOUT_MS = 10_000;

// 한 달에 공휴일이 이보다 많을 수 없다. 기본값(10)을 그대로 두면 연휴가 긴 달에서 잘린다.
const ROWS_PER_MONTH = 100;

// 오류 본문을 예외 메시지에 실을 때의 상한. 사유 한 줄을 살리되 문서 전체를 쏟지 않는다.
const ERROR_BODY_PREVIEW_LENGTH = 200;

@Injectable()
export class KoreanHolidayApiClient implements KoreanHolidayClientPort {
  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.readServiceKey());
  }

  async fetchMonth(year: number, month: number): Promise<KoreanHoliday[]> {
    const serviceKey = this.readServiceKey();
    if (!serviceKey) {
      // 여기 오면 호출부가 `isConfigured()` 를 묻지 않은 것이다. 키 없음을 빈 배열로
      // 돌려주면 "공휴일이 없는 해" 로 보여 동기화가 성공한 척한다.
      throw new Error(
        'KOREAN_HOLIDAY_API_KEY 가 설정되지 않아 특일 정보를 조회할 수 없습니다.',
      );
    }
    const url = new URL(ENDPOINT);
    // 공공데이터포털은 키를 「인코딩」·「디코딩」 두 벌로 준다. `URLSearchParams` 가 값을
    // 한 번 인코딩하므로 여기에는 **디코딩 키** 를 넣어야 한다 — 인코딩 키를 넣으면
    // `%2B` 가 `%252B` 로 이중 인코딩되어 서비스키 불일치(SERVICE_KEY_IS_NOT_REGISTERED_ERROR)
    // 로 떨어진다. 증상이 "키가 등록 안 됨" 이라 키를 다시 발급받는 쪽으로 헤매기 쉽다.
    url.searchParams.set('serviceKey', serviceKey);
    url.searchParams.set('solYear', String(year));
    url.searchParams.set('solMonth', String(month).padStart(2, '0'));
    url.searchParams.set('numOfRows', String(ROWS_PER_MONTH));
    url.searchParams.set('_type', 'json');

    const label = `${year}-${String(month).padStart(2, '0')}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // **본문을 읽어 사유를 함께 싣는다.** 잘못된 키는 `403` 과 함께 사유를 본문에 담아
    // 보낸다(2026-09-23 실측: `{"OpenAPI_ServiceResponse":{"cmmMsgHeader":
    // {"errMsg":"SERVICE_KEY_IS_NOT_REGISTERED_ERROR","returnReasonCode":"30"}}}`).
    // 상태 코드만 남기면 키가 틀린 것인지·권한이 없는 것인지·트래픽을 넘긴 것인지
    // 구분되지 않아, 정작 고칠 곳을 못 찾고 키를 다시 발급받는 쪽으로 헤매게 된다.
    if (!response.ok) {
      const reason = await response.text().catch(() => '');
      throw new Error(
        `특일 정보 조회 실패 (${label}): HTTP ${response.status}` +
          (reason ? ` — ${reason.slice(0, ERROR_BODY_PREVIEW_LENGTH)}` : ''),
      );
    }
    // `response.json()` 을 바로 부르지 않는다 — 실패하면 본문이 이미 소비돼 무엇이 왔는지
    // 볼 수 없다. `_type=json` 을 주면 오류도 JSON 으로 오지만(위 실측), 트래픽 초과 회차에
    // XML 이 돌아온다는 보고가 있어 그 경우에도 본문이 단서로 남게 둔다.
    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch (error: unknown) {
      throw new Error(
        `특일 정보 응답을 JSON 으로 읽지 못했습니다 (${label}): ` +
          `${String(error)} — 본문: ${text.slice(0, ERROR_BODY_PREVIEW_LENGTH)}`,
      );
    }
    // 해석 실패를 위 JSON 실패와 **같은 메시지로 뭉개지 않는다** — "JSON 이 아니다" 와
    // "JSON 은 맞는데 형태가 다르다" 는 고칠 곳이 다르다(전자는 인증·트래픽, 후자는 파서).
    try {
      return parseHolidayResponse(payload);
    } catch (error: unknown) {
      throw new Error(
        `특일 정보 응답을 해석하지 못했습니다 (${label}): ` +
          `${error instanceof Error ? error.message : String(error)}` +
          ` — 본문: ${text.slice(0, ERROR_BODY_PREVIEW_LENGTH)}`,
      );
    }
  }

  private readServiceKey(): string | undefined {
    return this.configService.get<string>('KOREAN_HOLIDAY_API_KEY')?.trim();
  }
}
