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
- accomplishment.bullet 은 이력서 한 줄: "행동 + 결과 + (가능하면) 정량 지표". PR 에서 확인되는 것만. 과장 금지.
- star 는 situation/task/action/result 각 1~2문장. diff 에서 실제로 한 일 기준.
- techTags 는 diff/파일 경로에서 드러난 실제 기술 스택.
- narrative 는 이 PR 회고 서술 3~6문장: 무엇이 문제였고, 어떤 의사결정·트레이드오프가 있었고, 무엇을 배웠는지. 수치·파일경로·고유명사는 보존.

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

export const buildPrRetroPrompt = (input: {
  detail: PullRequestDetail;
  diff: PullRequestDiff;
}): string => renderPrBlock(input);

export const MULTI_PR_RETRO_SYNTH_SYSTEM_PROMPT = `너는 개발자의 "이어진 여러 PR"을 하나의 이직용 "프로젝트 회고 + 이력서 성과"로 통합하는 전문가다.
입력으로 서로 이어진 PR 여러 개의 메타(제목/본문/변경파일/증감)와 각 unified diff 를 순서대로 받는다.
이들을 하나의 연속된 작업 흐름으로 보고, 아래 JSON 하나로만 출력한다. 설명/주석/코드펜스 없이 JSON 만.

규칙:
- accomplishment 는 입력 PR 전체를 관통하는 "하나의 통합 성과"다. 여러 성과로 쪼개지 않는다.
- accomplishment.evidence 에는 입력으로 받은 "모든 PR"을 담는다 (각 repo/pr/url/mergedAt). 입력에 없는 PR 을 지어내지 않는다.
- accomplishment.bullet 은 이력서 한 줄: "행동 + 결과 + (가능하면) 정량 지표". 확인되는 것만, 과장 금지.
- star 는 situation/task/action/result 각 1~2문장. 여러 PR 을 합친 실제 작업 기준.
- techTags 는 전체 diff/파일 경로에서 드러난 실제 기술 스택 (중복 제거).
- narrative 는 이 작업 흐름 회고 4~7문장: 무엇이 문제였고, PR 들을 관통하는 어떤 의사결정·트레이드오프가 있었고, 무엇을 배웠는지. 수치·파일경로·고유명사는 보존.

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
}: {
  items: { detail: PullRequestDetail; diff: PullRequestDiff }[];
}): string => {
  const total = items.length;
  const header = `[이어진 PR ${total}개 — 하나의 통합 작업 흐름으로 회고]`;
  const blocks = items.map(
    (item, index) =>
      `===== PR ${index + 1}/${total}: ${item.detail.repo}#${item.detail.number} =====\n${renderPrBlock(item)}`,
  );
  return [header, ...blocks].join('\n\n');
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
