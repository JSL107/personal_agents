import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { GithubPullRequestSummary } from '../../../../github/domain/github.type';
import { CareerMateException } from '../career-mate.exception';
import { CareerMateErrorCode } from '../career-mate-error-code.enum';
import { CareerProfileData } from '../career-mate.type';

export const CAREER_PROFILE_SYNTH_SYSTEM_PROMPT = `너는 개발자의 merged PR 이력을 이직용 "역량 프로필"로 합성하는 전문가다.
입력으로 PR 목록(제목/본문/저장소/증감 줄수/머지일)을 받는다.
아래 JSON 스키마 하나로만 출력한다. 설명/주석/코드펜스 없이 JSON 만.

규칙:
- 모든 skill 과 accomplishment 에는 근거가 된 PR 의 evidence(repo, pr 번호, url)를 반드시 1개 이상 포함한다. 증거 없는 항목은 만들지 않는다.
- accomplishment.bullet 은 이력서 한 줄: "행동 + 결과 + (가능하면) 정량 지표".
- star 는 situation/task/action/result 각 1~2문장.
- skills.category 는 LANGUAGE | FRAMEWORK | DOMAIN | TOOL 중 하나, proficiency 는 FAMILIAR | PROFICIENT | EXPERT 중 하나(증거 PR 수/난이도로 판단).
- 과장 금지. PR 에서 확인되는 것만.

스키마:
{
  "summary": "2~3문장 헤드라인",
  "skills": [{"name","category","proficiency","evidence":[{"repo","pr","url"}]}],
  "accomplishments": [{"title","bullet","star":{"situation","task","action","result"},"techTags":[],"evidence":[{"repo","pr","url","mergedAt"}]}],
  "meta": {"githubLogin","windowStart","prCount"}
}`;

export const buildSynthPrompt = (prs: GithubPullRequestSummary[]): string => {
  const lines = prs.map((pr) => {
    const body = (pr.body ?? '').replace(/\s+/g, ' ').slice(0, 400);
    return `- ${pr.repo}#${pr.number} "${pr.title}" (+${pr.additions}/-${pr.deletions}, files ${pr.changedFilesCount}, merged ${pr.mergedAt}) url=${pr.url}\n  본문: ${body}`;
  });
  return `다음은 합성 대상 merged PR ${prs.length}건이다.\n\n${lines.join('\n')}`;
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

export const parseCareerProfileOutput = (text: string): CareerProfileData => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return invalid('프로필 생성 실패 — 모델 출력이 JSON 이 아닙니다.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return invalid('프로필 생성 실패 — 모델 출력 형식 오류.');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.summary !== 'string') {
    return invalid('프로필 생성 실패 — summary 누락.');
  }
  if (!Array.isArray(obj.skills) || !Array.isArray(obj.accomplishments)) {
    return invalid('프로필 생성 실패 — skills/accomplishments 가 배열이 아닙니다.');
  }
  if (typeof obj.meta !== 'object' || obj.meta === null) {
    return invalid('프로필 생성 실패 — meta 누락.');
  }
  return parsed as CareerProfileData;
};
