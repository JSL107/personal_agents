import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { CareerMateException } from '../career-mate.exception';
import { CareerMateAction, CareerMateIntent } from '../career-mate.type';
import { CareerMateErrorCode } from '../career-mate-error-code.enum';

export const CAREER_MATE_INTENT_SYSTEM_PROMPT = `너는 "이직 메이트"의 자연어 의도 분류기다.
사용자 메시지를 아래 JSON 하나로만 변환한다. 설명/주석 없이 JSON 만 출력한다.

action 은 다음 중 하나:
- "BUILD_PROFILE": 역량 프로필을 새로 만들거나 갱신 ("프로필 정리해줘", "내 역량 정리", "경력 업데이트"). 기간 언급이 있으면 windowMonths(정수 개월)로.
- "RENDER_RESUME": 이력서/성과 bullet 출력 ("이력서 뽑아줘", "성과 bullet", "resume").
- "RENDER_PORTFOLIO": 포트폴리오 페이지 생성 ("포트폴리오 정리", "포트폴리오 페이지").
- "ANALYZE_JD_GAP": 목표 공고(JD)와 내 역량을 대조해 갭/블로그주제 분석 ("이 공고 갭 분석", "이 JD 로 뭐가 부족한지", "이 포지션 분석해줘"). JD 본문이 함께 붙어온다.
- "CALIBRATE_RESUME": 내 이력서/프로필을 현재 채용 기준과 대조해 보정 점검 ("이력서 점검해줘", "내 이력서 요즘 기준에 맞나", "이력서 보정", "이력서 검토").
- "REFLECT_PR": 특정 PR 하나 이상을 회고해서 이력서/포트폴리오에 반영 ("이 PR 회고해줘", "이 PR들 묶어서 회고", "이 작업들 회고해서 성과로"). PR URL 또는 owner/repo#번호 가 하나 이상 함께 온다. 이어진 여러 PR 이면 전부 넘긴다.
- "UNKNOWN": 위에 해당 없음.

출력 예시:
{"action":"BUILD_PROFILE","windowMonths":12}
{"action":"RENDER_RESUME"}`;

const VALID_ACTIONS: CareerMateAction[] = [
  'BUILD_PROFILE',
  'RENDER_RESUME',
  'RENDER_PORTFOLIO',
  'ANALYZE_JD_GAP',
  'CALIBRATE_RESUME',
  'REFLECT_PR',
  'UNKNOWN',
];

const stripCodeFence = (text: string): string =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

export const parseCareerMateIntent = (text: string): CareerMateIntent => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    throw new CareerMateException({
      code: CareerMateErrorCode.NL_PARSE_FAILED,
      message:
        '요청을 이해하지 못했습니다. "프로필 정리해줘" / "이력서 뽑아줘" / "포트폴리오 정리" 처럼 말씀해주세요.',
      status: DomainStatus.BAD_GATEWAY,
    });
  }
  if (typeof parsed !== 'object' || parsed === null || !('action' in parsed)) {
    return { action: 'UNKNOWN' };
  }
  const obj = parsed as Record<string, unknown>;
  const action = VALID_ACTIONS.includes(obj.action as CareerMateAction)
    ? (obj.action as CareerMateAction)
    : 'UNKNOWN';
  const windowMonths =
    Number.isInteger(obj.windowMonths) && Number(obj.windowMonths) > 0
      ? Number(obj.windowMonths)
      : undefined;
  return windowMonths ? { action, windowMonths } : { action };
};
