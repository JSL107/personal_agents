import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import {
  PullRequestDetail,
  PullRequestDiff,
} from '../../../../github/domain/github.type';
import { CareerMateException } from '../career-mate.exception';
import { PrRetroSynth } from '../career-mate.type';
import { CareerMateErrorCode } from '../career-mate-error-code.enum';

export const PR_RETRO_SYNTH_SYSTEM_PROMPT = `너는 개발자의 단일 PR 하나를 이직용 "프로젝트 회고 + 이력서 성과"로 변환하는 전문가다.
입력으로 PR 메타(제목/본문/변경파일/증감)와 unified diff 를 받는다.
아래 JSON 하나로만 출력한다. 설명/주석/코드펜스 없이 JSON 만.

규칙:
- accomplishment.evidence 는 입력으로 받은 그 PR 하나로 고정한다 (repo/pr/url/mergedAt). 다른 PR 을 지어내지 않는다.
- accomplishment.bullet 은 이력서 한 줄: "행동 + 결과 + 정량 지표". 지표는 PR 제목·본문·diff 또는 [작업 맥락] 에 문자로 적힌 값만 원문 그대로 옮긴다 (예: "69% -> 6%", "3/6 -> 0/6", "30분 -> 2분"). 적혀 있으면 반드시 싣고, 적혀 있지 않으면 지표 없이 쓴다. 추정·계산·반올림으로 새 숫자를 만들지 않는다. 과장 금지.
- star 는 situation/task/action/result 각 1~2문장. diff 에서 실제로 한 일 기준. [작업 맥락] 이 있으면 result 에 그 영향을 담는다.
- techTags 는 diff/파일 경로에서 드러난 실제 기술 스택.
- narrative 는 이 PR 회고 서술 3~6문장: 무엇이 문제였고, 어떤 의사결정·트레이드오프가 있었고, 무엇을 배웠는지. 수치·파일경로·고유명사는 보존.
- [작업 맥락] 은 사용자가 직접 적은 "이 작업이 서비스에 무엇을 했는지"다. 코드에 남지 않는 사실이므로 지표의 출처로 인정한다 — 거기 문자로 적힌 값도 원문 그대로 옮긴다.
- 입력에 [작업 맥락] 절이 없으면 사용자·매출·비용·처리량 영향을 추측해 쓰지 않는다. 없는 수치를 지어내느니 그 문장을 아예 쓰지 않는다.

스키마:
{
  "accomplishment": {
    "title": "성과 한 줄 제목",
    "bullet": "이력서 bullet",
    "star": {"situation","task","action","result"},
    "techTags": [],
    "evidence": [{"repo","pr","url","mergedAt"}]
  },
  "narrative": "회고 서술"
}`;

const renderPrBlock = ({
  detail,
  diff,
}: {
  detail: PullRequestDetail;
  diff: PullRequestDiff;
}): string => {
  const truncatedNote = detail.changedFilesTruncated
    ? ` (잘림: 전체 ${detail.changedFilesTotalCount}개 중 ${detail.changedFiles.length}개만 노출)`
    : '';
  const diffNote = diff.truncated
    ? `\n\n(diff 가 ${diff.bytes} bytes 라 일부만 전달됨 — 잘린 뒷부분은 모를 수 있음)`
    : '';
  return [
    `[PR 메타]`,
    `- repo: ${detail.repo}`,
    `- number: #${detail.number}`,
    `- title: ${detail.title}`,
    `- author: ${detail.authorLogin}`,
    `- branch: ${detail.headRef} → ${detail.baseRef}`,
    `- additions/deletions: +${detail.additions} / -${detail.deletions}`,
    `- url: ${detail.url}`,
    `- changed files${truncatedNote}:`,
    ...detail.changedFiles.map((file) => `  - ${file}`),
    ``,
    `[PR 본문]`,
    detail.body || '(없음)',
    ``,
    `[diff]${diffNote}`,
    '```diff',
    diff.diff,
    '```',
  ].join('\n');
};

// 사용자가 승인 카드에 적어 넣은 "이 작업이 무엇에 영향을 갔는지". 프롬프트 맨 앞에 둔다 —
// PR 블록 뒤에 붙이면 diff 수천 줄 아래로 밀려 모델이 사실상 보지 않는다.
// 값이 없으면 절 자체를 넣지 않는다. 빈 절을 넣으면 모델이 "맥락 없음"을 근거로 삼아
// 오히려 없는 영향을 채워 넣으려 하고, 도입 전 프롬프트와도 달라진다.
const CAREER_IMPACT_CONTEXT_HEADING = '[작업 맥락 — 사용자가 직접 적은 영향]';

const renderImpactContextBlock = (
  impactContext: string | undefined,
): string[] => {
  const trimmed = impactContext?.trim() ?? '';
  if (trimmed.length === 0) {
    return [];
  }
  return [`${CAREER_IMPACT_CONTEXT_HEADING}\n${trimmed}`];
};

export const buildPrRetroPrompt = ({
  impactContext,
  ...input
}: {
  detail: PullRequestDetail;
  diff: PullRequestDiff;
  impactContext?: string;
}): string =>
  [...renderImpactContextBlock(impactContext), renderPrBlock(input)].join(
    '\n\n',
  );

export const MULTI_PR_RETRO_SYNTH_SYSTEM_PROMPT = `너는 개발자의 "이어진 여러 PR"을 하나의 이직용 "프로젝트 회고 + 이력서 성과"로 통합하는 전문가다.
입력으로 서로 이어진 PR 여러 개의 메타(제목/본문/변경파일/증감)와 각 unified diff 를 순서대로 받는다.
이들을 하나의 연속된 작업 흐름으로 보고, 아래 JSON 하나로만 출력한다. 설명/주석/코드펜스 없이 JSON 만.

규칙:
- accomplishment 는 입력 PR 전체를 관통하는 "하나의 통합 성과"다. 여러 성과로 쪼개지 않는다.
- accomplishment.evidence 에는 입력으로 받은 "모든 PR"을 담는다 (각 repo/pr/url/mergedAt). 입력에 없는 PR 을 지어내지 않는다.
- accomplishment.bullet 은 이력서 한 줄: "행동 + 결과 + 정량 지표". 지표는 PR 제목·본문·diff 또는 [작업 맥락] 에 문자로 적힌 값만 원문 그대로 옮긴다 (예: "69% -> 6%", "3/6 -> 0/6", "30분 -> 2분"). 적혀 있으면 반드시 싣고, 적혀 있지 않으면 지표 없이 쓴다. 추정·계산·반올림으로 새 숫자를 만들지 않는다. 과장 금지.
- star 는 situation/task/action/result 각 1~2문장. 여러 PR 을 합친 실제 작업 기준. [작업 맥락] 이 있으면 result 에 그 영향을 담는다.
- techTags 는 전체 diff/파일 경로에서 드러난 실제 기술 스택 (중복 제거).
- narrative 는 이 작업 흐름 회고 4~7문장: 무엇이 문제였고, PR 들을 관통하는 어떤 의사결정·트레이드오프가 있었고, 무엇을 배웠는지. 수치·파일경로·고유명사는 보존.
- [작업 맥락] 은 사용자가 직접 적은 "이 작업이 서비스에 무엇을 했는지"다. 코드에 남지 않는 사실이므로 지표의 출처로 인정한다 — 거기 문자로 적힌 값도 원문 그대로 옮긴다.
- 입력에 [작업 맥락] 절이 없으면 사용자·매출·비용·처리량 영향을 추측해 쓰지 않는다. 없는 수치를 지어내느니 그 문장을 아예 쓰지 않는다.

스키마:
{
  "accomplishment": {
    "title": "성과 한 줄 제목",
    "bullet": "이력서 bullet",
    "star": {"situation","task","action","result"},
    "techTags": [],
    "evidence": [{"repo","pr","url","mergedAt"}]
  },
  "narrative": "회고 서술"
}`;

export const buildMultiPrRetroPrompt = ({
  items,
  impactContext,
}: {
  items: { detail: PullRequestDetail; diff: PullRequestDiff }[];
  impactContext?: string;
}): string => {
  const total = items.length;
  const header = `[이어진 PR ${total}개 — 하나의 통합 작업 흐름으로 회고]`;
  const blocks = items.map(
    (item, index) =>
      `===== PR ${index + 1}/${total}: ${item.detail.repo}#${item.detail.number} =====\n${renderPrBlock(item)}`,
  );
  return [...renderImpactContextBlock(impactContext), header, ...blocks].join(
    '\n\n',
  );
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

export const parsePrRetroOutput = (text: string): PrRetroSynth => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return invalid('PR 회고 생성 실패 — 모델 출력이 JSON 이 아닙니다.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return invalid('PR 회고 생성 실패 — 출력 형식 오류.');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.narrative !== 'string' || obj.narrative.trim().length === 0) {
    return invalid('PR 회고 생성 실패 — narrative 누락.');
  }
  if (!isAccomplishment(obj.accomplishment)) {
    return invalid('PR 회고 생성 실패 — accomplishment 형태 오류.');
  }
  return parsed as PrRetroSynth;
};

const isAccomplishment = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  const star = item.star as Record<string, unknown> | undefined;
  return (
    typeof item.title === 'string' &&
    typeof item.bullet === 'string' &&
    Array.isArray(item.evidence) &&
    item.evidence.length > 0 &&
    typeof star === 'object' &&
    star !== null &&
    typeof star.situation === 'string' &&
    typeof star.task === 'string' &&
    typeof star.action === 'string' &&
    typeof star.result === 'string'
  );
};
