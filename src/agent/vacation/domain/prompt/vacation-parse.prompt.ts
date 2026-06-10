import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { parsePlainDate, PlainDate } from '../plain-date';
import { VacationException } from '../vacation.exception';
import { VacationErrorCode } from '../vacation-error-code.enum';

export const VACATION_PARSE_SYSTEM_PROMPT = `너는 휴가 관리 봇의 자연어 의도 분류기다.
사용자 메시지를 아래 JSON 스키마 하나로만 변환한다. 설명/주석 없이 JSON 만 출력한다.

action 은 다음 중 하나:
- "BALANCE": 남은 휴가/잔여 조회 ("며칠 남았어", "휴가 잔여")
- "LIST": 사용 내역 조회 ("휴가 내역 보여줘")
- "REGISTER": 휴가 사용 등록. startDate/endDate 를 YYYY-MM-DD 로. 단일일이면 둘이 같다. memo 는 선택.
- "CANCEL": 등록 취소. usageId(정수) 필요.
- "UNKNOWN": 위에 해당 없음.

오늘 날짜 기준은 입력의 [오늘: YYYY-MM-DD] 를 사용해 상대 표현("내일","다음주 월요일")을 절대 날짜로 변환한다.

출력 예시:
{"action":"REGISTER","startDate":"2026-07-01","endDate":"2026-07-03","memo":"가족여행"}
{"action":"BALANCE"}`;

export interface NlVacationIntent {
  action: 'BALANCE' | 'LIST' | 'REGISTER' | 'CANCEL' | 'UNKNOWN';
  startDate?: PlainDate;
  endDate?: PlainDate;
  memo?: string;
  usageId?: number;
}

const stripCodeFence = (text: string): string => {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
};

const fail = (message: string): never => {
  throw new VacationException({
    code: VacationErrorCode.NL_PARSE_FAILED,
    message,
    status: DomainStatus.BAD_GATEWAY,
  });
};

// LLM 응답(JSON 문자열) → 구조화 의도. 날짜는 PlainDate 로 검증 변환.
export const parseNlVacationIntent = (text: string): NlVacationIntent => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return fail(
      '자연어를 이해하지 못했습니다. 슬래시 명령(`/휴가`)을 사용해주세요.',
    );
  }
  if (typeof parsed !== 'object' || parsed === null || !('action' in parsed)) {
    return fail('자연어 의도를 해석하지 못했습니다.');
  }
  const obj = parsed as Record<string, unknown>;
  const action = obj.action;

  if (action === 'BALANCE' || action === 'LIST' || action === 'UNKNOWN') {
    return { action };
  }
  if (action === 'CANCEL') {
    const usageId = Number(obj.usageId);
    if (!Number.isInteger(usageId)) {
      return fail('취소할 휴가 번호를 알 수 없습니다.');
    }
    return { action, usageId };
  }
  if (action === 'REGISTER') {
    const startDate =
      typeof obj.startDate === 'string' ? parsePlainDate(obj.startDate) : null;
    const endDate =
      typeof obj.endDate === 'string' ? parsePlainDate(obj.endDate) : startDate;
    if (!startDate || !endDate) {
      return fail(
        '휴가 날짜를 정확히 읽지 못했습니다. `/휴가 사용 YYYY-MM-DD~YYYY-MM-DD` 형식으로 주세요.',
      );
    }
    return {
      action,
      startDate,
      endDate,
      memo:
        typeof obj.memo === 'string' && obj.memo.trim()
          ? obj.memo.trim()
          : undefined,
    };
  }
  return fail('알 수 없는 휴가 의도입니다.');
};
