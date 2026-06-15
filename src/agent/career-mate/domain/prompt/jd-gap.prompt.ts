import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { CareerMateException } from '../career-mate.exception';
import { CareerProfileData, GapAnalysisData } from '../career-mate.type';
import { CareerMateErrorCode } from '../career-mate-error-code.enum';

export const JD_GAP_SYSTEM_PROMPT = `너는 이직 코치다. 지원자의 "증거 기반 역량 프로필"과 목표 공고(JD)를 대조해
적합도/보유/갭을 진단하고, 갭을 메우는 블로그·학습 주제를 제안한다.
아래 JSON 하나로만 출력한다. 설명/주석/코드펜스 없이 JSON 만.

규칙:
- have: JD 요구 중 프로필에서 이미 입증된 역량.
- gaps: JD 요구 중 부족/미입증.
- topics: 갭을 메우는 블로그/학습 주제 3개. 각 title(한 줄) + rationale(어떤 갭을 왜 메우는지). 프로필의 실제 경험과 연결.
- 과장 금지. 프로필·JD 에서 확인되는 것만.

스키마:
{"fitSummary":"2~3문장","have":["..."],"gaps":["..."],"topics":[{"title":"...","rationale":"..."}]}`;

export const buildJdGapPrompt = (
  profile: CareerProfileData,
  jdText: string,
): string => {
  const skills = profile.skills
    .map((s) => `- ${s.name} (${s.category}/${s.proficiency})`)
    .join('\n');
  const accomplishments = profile.accomplishments
    .map((a) => `- ${a.bullet}`)
    .join('\n');
  return [
    `[내 역량 프로필]`,
    `요약: ${profile.summary}`,
    `스킬:\n${skills || '(없음)'}`,
    `성과:\n${accomplishments || '(없음)'}`,
    ``,
    `[목표 공고(JD)]`,
    jdText,
  ].join('\n');
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

export const parseGapAnalysisOutput = (text: string): GapAnalysisData => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return invalid('갭 분석 실패 — 모델 출력이 JSON 이 아닙니다.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return invalid('갭 분석 실패 — 출력 형식 오류.');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.fitSummary !== 'string') {
    return invalid('갭 분석 실패 — fitSummary 누락.');
  }
  if (
    !Array.isArray(obj.have) ||
    !Array.isArray(obj.gaps) ||
    !Array.isArray(obj.topics)
  ) {
    return invalid('갭 분석 실패 — have/gaps/topics 가 배열이 아닙니다.');
  }
  return parsed as GapAnalysisData;
};
