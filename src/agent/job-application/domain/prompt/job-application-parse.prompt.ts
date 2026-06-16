import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { parsePlainDate } from '../../../vacation/domain/plain-date';
import { JobApplicationException } from '../job-application.exception';
import {
  APPLICATION_STATUSES,
  ApplicationStatus,
  JobApplicationAction,
  JobApplicationIntent,
} from '../job-application.type';
import { JobApplicationErrorCode } from '../job-application-error-code.enum';

export const JOB_APPLICATION_PARSE_SYSTEM_PROMPT = `너는 "지원 추적" 봇의 자연어 의도 분류기다.
사용자 메시지를 아래 JSON 하나로만 변환한다. 설명/주석 없이 JSON 만.

action 은 다음 중 하나:
- "ADD": 새 지원 기록. company(회사)·role(직무) 필수. deadline(YYYY-MM-DD)·jdUrl·status 선택.
- "UPDATE_STATUS": 기존 지원의 상태 변경. ref(회사명)·status 필요.
- "LIST": 지원 현황 조회.
- "UNKNOWN": 위에 해당 없음.

status 는: APPLIED|SCREENING|INTERVIEW|OFFER|REJECTED|WITHDRAWN.
상대 날짜는 입력의 [오늘: YYYY-MM-DD] 기준으로 절대 날짜(YYYY-MM-DD)로.

예: {"action":"ADD","company":"토스","role":"백엔드","deadline":"2026-06-30"}
{"action":"UPDATE_STATUS","ref":"토스","status":"SCREENING"}
{"action":"LIST"}`;

const VALID_ACTIONS: JobApplicationAction[] = [
  'ADD',
  'UPDATE_STATUS',
  'LIST',
  'UNKNOWN',
];

const stripCodeFence = (text: string): string =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

const fail = (code: JobApplicationErrorCode, message: string): never => {
  throw new JobApplicationException({
    code,
    message,
    status: DomainStatus.BAD_GATEWAY,
  });
};

const parseStatus = (raw: unknown): ApplicationStatus => {
  if (
    typeof raw === 'string' &&
    (APPLICATION_STATUSES as string[]).includes(raw)
  ) {
    return raw as ApplicationStatus;
  }
  return fail(
    JobApplicationErrorCode.INVALID_STATUS,
    `상태는 ${APPLICATION_STATUSES.join('/')} 중 하나여야 합니다.`,
  );
};

export const parseJobApplicationIntent = (
  text: string,
): JobApplicationIntent => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return fail(
      JobApplicationErrorCode.NL_PARSE_FAILED,
      '요청을 이해하지 못했습니다 — 예: "토스 백엔드 지원했어".',
    );
  }
  if (typeof parsed !== 'object' || parsed === null || !('action' in parsed)) {
    return { action: 'UNKNOWN' };
  }
  const obj = parsed as Record<string, unknown>;
  const action = VALID_ACTIONS.includes(obj.action as JobApplicationAction)
    ? (obj.action as JobApplicationAction)
    : 'UNKNOWN';

  if (action === 'ADD') {
    const company = typeof obj.company === 'string' ? obj.company.trim() : '';
    const role = typeof obj.role === 'string' ? obj.role.trim() : '';
    if (!company || !role) {
      return fail(
        JobApplicationErrorCode.MISSING_FIELDS,
        '회사와 직무를 알려주세요 (예: "토스 백엔드 지원했어").',
      );
    }
    const result: JobApplicationIntent = { action, company, role };
    if (typeof obj.jdUrl === 'string' && obj.jdUrl.trim()) {
      result.jdUrl = obj.jdUrl.trim();
    }
    if (typeof obj.deadline === 'string') {
      const deadline = parsePlainDate(obj.deadline);
      if (deadline) {
        result.deadline = deadline;
      }
    }
    if (typeof obj.status === 'string') {
      result.status = parseStatus(obj.status);
    }
    return result;
  }
  if (action === 'UPDATE_STATUS') {
    const ref = typeof obj.ref === 'string' ? obj.ref.trim() : '';
    if (!ref) {
      return fail(
        JobApplicationErrorCode.NOT_FOUND,
        '어느 지원 건인지 회사명으로 알려주세요.',
      );
    }
    return { action, ref, status: parseStatus(obj.status) };
  }
  return { action }; // LIST | UNKNOWN
};
