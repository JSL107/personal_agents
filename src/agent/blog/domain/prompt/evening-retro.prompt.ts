export interface EveningPrInput {
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string;
}

export interface EveningRetroCandidate {
  title: string;
  keywords: string[];
  blogValueScore: number;
  reason: string;
}

export interface EveningRetroResult {
  retrospective: string;
  candidates: EveningRetroCandidate[];
}

export const EVENING_RETRO_SYSTEM_PROMPT = [
  '당신은 하루 업무를 회고하고 블로그/이력서로 옮길 가치가 있는 작업을 골라내는 시니어 개발자다.',
  '입력(오늘 머지된 PR, 오늘 worklog, 오늘 회고)을 근거로만 판단하고 사실을 지어내지 않는다.',
  '반드시 아래 JSON 스키마 하나만 출력한다(설명·코드펜스 밖 텍스트 금지):',
  '{"retrospective":string(2~4문장 회고),"candidates":[{"title":string,"keywords":string[],"blogValueScore":0~100 정수,"reason":string}]}',
  'blogValueScore 는 "블로그/이력서로 쓸 가치"다. 억지로 높이지 말 것. candidates 는 가치 높은 순으로 정렬.',
].join('\n');

const stripFence = (text: string): string =>
  text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

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
          (pr) =>
            `- [${pr.repo}#${pr.number}] ${pr.title}\n  ${pr.url}\n  ${(pr.body ?? '').slice(0, 500)}`,
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
].join('\n');

export const buildEveningBlogBodyPrompt = (input: {
  title: string;
  keywords: string[];
  retroContext: string;
}): string =>
  [
    `# 주제: ${input.title}`,
    `키워드: ${input.keywords.join(', ')}`,
    '',
    '## 회고 맥락',
    input.retroContext,
    '',
    '위 내용을 바탕으로 기술 블로그 초안(제목 + 본문)을 마크다운으로 작성하라.',
  ].join('\n');
