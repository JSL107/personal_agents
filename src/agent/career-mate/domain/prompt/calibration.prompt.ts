import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { CareerMateException } from '../career-mate.exception';
import { CalibrationResultData, CareerProfileData } from '../career-mate.type';
import { CareerMateErrorCode } from '../career-mate-error-code.enum';

export const CALIBRATION_SYSTEM_PROMPT = `너는 2026년 채용 시장 기준에 정통한 이력서 코치다.
지원자의 "증거 기반 역량 프로필"을 현재 이력서 작성 기준과 대조해 보정점을 진단한다.
[최신 시장 트렌드] 섹션이 주어지면 그 정보를 우선 반영한다.
아래 JSON 하나로만 출력한다. 설명/주석/코드펜스 없이 JSON 만.

진단 기준:
- aiSlopRisks: generic/AI 티 나는 모호한 표현(구체성·고유성 부족).
- underQuantified: 정량 지표(수치/비율/규모)가 빠진 성과.
- outdatedPhrasing: 2026 기준 진부하거나 구식인 표현.
- missingKeywords: 타겟 직무에서 기대되나 프로필에 없는 역량/키워드.
- actionItems: 우선순위 개선 액션(구체적, 실행가능).
- verdict: 한 줄 총평 + 현재 기준 적합도.
과장 금지. 프로필에서 확인되는 것만.

스키마:
{"verdict":"...","aiSlopRisks":["..."],"underQuantified":["..."],"outdatedPhrasing":["..."],"missingKeywords":["..."],"actionItems":["..."]}`;

export const buildCalibrationPrompt = (
  profile: CareerProfileData,
  webTrendsNote?: string,
): string => {
  const skills = profile.skills
    .map((s) => `- ${s.name} (${s.category}/${s.proficiency})`)
    .join('\n');
  const accomplishments = profile.accomplishments
    .map((a) => `- ${a.bullet}`)
    .join('\n');
  const sections = [
    `[내 역량 프로필]`,
    `요약: ${profile.summary}`,
    `스킬:\n${skills || '(없음)'}`,
    `성과:\n${accomplishments || '(없음)'}`,
  ];
  if (webTrendsNote && webTrendsNote.trim().length > 0) {
    sections.push(`\n[최신 시장 트렌드]\n${webTrendsNote.trim()}`);
  }
  return sections.join('\n');
};

const stripCodeFence = (text: string): string =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

const invalid = (message: string): never => {
  throw new CareerMateException({
    code: CareerMateErrorCode.INVALID_MODEL_OUTPUT,
    message,
    status: DomainStatus.BAD_GATEWAY,
  });
};

export const parseCalibrationOutput = (text: string): CalibrationResultData => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return invalid('보정 점검 실패 — 모델 출력이 JSON 이 아닙니다.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return invalid('보정 점검 실패 — 출력 형식 오류.');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.verdict !== 'string') {
    return invalid('보정 점검 실패 — verdict 누락.');
  }
  const arrays = [
    'aiSlopRisks',
    'underQuantified',
    'outdatedPhrasing',
    'missingKeywords',
    'actionItems',
  ];
  for (const key of arrays) {
    if (!Array.isArray(obj[key])) {
      return invalid(`보정 점검 실패 — ${key} 가 배열이 아닙니다.`);
    }
  }
  return parsed as CalibrationResultData;
};
