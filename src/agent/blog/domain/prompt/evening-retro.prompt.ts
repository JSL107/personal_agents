import {
  REPO_SOURCE_LABEL,
  RepoSource,
} from '../../../../common/util/repo-source.util';

export interface EveningPrInput {
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string;
  source?: RepoSource;
}

export interface EveningRetroCandidate {
  title: string;
  keywords: string[];
  blogValueScore: number;
  reason: string;
  sourceRefs: string[];
}

export interface EveningRetroResult {
  retrospective: string;
  candidates: EveningRetroCandidate[];
}

export interface EveningBlogSourcePr {
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string;
}

export const EVENING_RETRO_SYSTEM_PROMPT = [
  '당신은 하루 업무를 회고하고 블로그/이력서로 옮길 가치가 있는 작업을 골라내는 시니어 개발자다.',
  '입력(오늘 머지된 PR, 오늘 worklog, 오늘 회고)을 근거로만 판단하고 사실을 지어내지 않는다.',
  '반드시 아래 JSON 스키마 하나만 출력한다(설명·코드펜스 밖 텍스트 금지):',
  '{"retrospective":string(2~4문장 회고),"candidates":[{"title":string,"keywords":string[],"blogValueScore":0~100 정수,"reason":string,"sourceRefs":string[]}]}',
  '각 candidate 는 근거가 된 PR 을 sourceRefs 에 정확히 명시한다(입력 PR 목록의 owner/repo#number 그대로). 지어내지 말 것.',
  'blogValueScore 는 "블로그/이력서로 쓸 가치"다. 억지로 높이지 말 것. candidates 는 가치 높은 순으로 정렬.',
].join('\n');

const stripFence = (text: string): string =>
  text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

const formatPromptSourceLabel = (source: RepoSource): string => {
  if (source === 'personal') {
    return '개인 프로젝트';
  }
  return REPO_SOURCE_LABEL[source];
};

export const parseEveningRetroOutput = (text: string): EveningRetroResult => {
  const raw = stripFence(text ?? '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('EVENING_RETRO_PARSE_FAILED: JSON 파싱 실패');
  }
  const value = parsed as Partial<EveningRetroResult>;
  if (
    typeof value?.retrospective !== 'string' ||
    !Array.isArray(value?.candidates)
  ) {
    throw new Error('EVENING_RETRO_PARSE_FAILED: 필수 필드 누락');
  }
  return {
    retrospective: value.retrospective,
    candidates: value.candidates.map((candidate) => ({
      title: String(candidate.title ?? ''),
      keywords: Array.isArray(candidate.keywords)
        ? candidate.keywords.map(String)
        : [],
      blogValueScore: Number(candidate.blogValueScore ?? 0),
      reason: String(candidate.reason ?? ''),
      sourceRefs: Array.isArray(candidate.sourceRefs)
        ? candidate.sourceRefs.map(String)
        : [],
    })),
  };
};

export const buildEveningRetroPrompt = (input: {
  mergedPrs: EveningPrInput[];
  worklogText: string | null;
  dailyEvalText: string | null;
}): string => {
  const prSection = input.mergedPrs.length
    ? input.mergedPrs
        .map(
          (pullRequest) =>
            `- [${formatPromptSourceLabel(pullRequest.source ?? 'company')}][${pullRequest.repo}#${pullRequest.number}] ${pullRequest.title}\n  ${pullRequest.url}\n  ${(pullRequest.body ?? '').slice(0, 500)}`,
        )
        .join('\n')
    : '(오늘 머지된 PR 없음)';
  return [
    '## 오늘 머지된 PR',
    prSection,
    '',
    '## 오늘 worklog',
    input.worklogText ?? '(없음)',
    '',
    '## 오늘 회고(daily-eval)',
    input.dailyEvalText ?? '(없음)',
  ].join('\n');
};

export const EVENING_BLOG_BODY_SYSTEM_PROMPT = [
  '당신은 개발 블로그를 쓰는 시니어 엔지니어다. 주어진 작업을 한국어 기술 블로그 초안으로 작성한다.',
  '과장 없이, 문제→접근→결과 흐름으로. 마크다운(## 소제목, 본문 단락) 형식.',
  '제목이 아니라 아래 근거 PR 의 실제 변경 내용(문제→접근→결과)을 바탕으로 구체적으로 작성한다. 근거에 없는 사실은 지어내지 않는다.',
].join('\n');

const SOURCE_PR_BODY_MAX_CHARS = 800;
const SOURCE_PR_PROMPT_LIMIT = 5;

export const buildEveningBlogBodyPrompt = (input: {
  title: string;
  keywords: string[];
  reason?: string;
  retroContext: string;
  sourcePrs?: EveningBlogSourcePr[];
}): string => {
  const sourcePrSection =
    input.sourcePrs && input.sourcePrs.length > 0
      ? input.sourcePrs
          .slice(0, SOURCE_PR_PROMPT_LIMIT)
          .map(
            (sourcePullRequest) =>
              `- [${sourcePullRequest.repo}#${sourcePullRequest.number}] ${sourcePullRequest.title}\n  ${sourcePullRequest.url}\n  ${(sourcePullRequest.body ?? '').slice(0, SOURCE_PR_BODY_MAX_CHARS)}`,
          )
          .join('\n')
      : '(근거 PR 본문 없음)';

  return [
    `# 주제: ${input.title}`,
    `키워드: ${input.keywords.join(', ')}`,
    '',
    '## 왜 쓸 가치',
    input.reason?.trim() || '(없음)',
    '',
    '## 근거 PR',
    sourcePrSection,
    '',
    '## 회고 맥락',
    input.retroContext,
    '',
    '위 근거 PR 의 실제 변경 내용을 바탕으로 기술 블로그 초안(제목 + 본문)을 마크다운으로 작성하라.',
  ].join('\n');
};
