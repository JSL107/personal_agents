import { READER_WRITING_RULES } from '../../../../common/llm/reader-writing-rules';
import { extractJsonObjectText } from '../../../../common/util/llm-json-extract.util';
import { ProjectGroupNaming } from '../project-group';

export interface CoverPromptCard {
  key: string;
  repo: string;
  anonymized: boolean;
  period: string;
  techStack: string[];
  processLines: string[];
  previousTitle: string;
  previousSummary: string;
}

export const PORTFOLIO_COVER_SYSTEM_PROMPT = `너는 개발자의 프로젝트 표지를 작성한다. 입력 카드마다 JSON 항목 하나를 출력한다.
key 는 입력 그대로 사용한다. 제목은 30자 이내, 요약은 한 문장, 문제와 결과는 1~3문장이다.
구성이 크게 바뀌지 않았으면 제목을 유지한다. 이전 제목·요약을 참고하되 현재 과정에 없는 사실은 쓰지 않는다.
highlights 는 가장 대표적인 성과부터 0~3개, 각 40자 이내다. 과정에 적힌 숫자만 사용한다.
PR·커밋·테스트 통과 건수는 성과가 아니다. 익명 카드의 저장소·회사·서비스 이름은 쓰거나 추측하지 않는다.
한국어로 쓰고 JSON 객체 하나만 출력한다. 설명이나 코드펜스를 붙이지 않는다.

${READER_WRITING_RULES}

스키마:
{"projects":[{"key":"입력 key","title":"제목","summary":"한 문장","problem":"문제","result":"결과","highlights":["성과 줄"]}]}`;

const formatCard = (card: CoverPromptCard): string =>
  [
    `key: ${card.key}`,
    card.anonymized
      ? 'anonymous: true (저장소 이름 비공개 — 이름을 쓰거나 추측하지 말 것)'
      : `repo: ${card.repo}`,
    `기간: ${card.period || '미상'}`,
    `기술: ${card.techStack.join(', ') || '미상'}`,
    `이전 제목: ${card.previousTitle || '없음'}`,
    `이전 요약: ${card.previousSummary || '없음'}`,
    '과정:',
    ...card.processLines
      .slice(0, 10)
      .map((line, index) => `${index + 1}. ${line}`),
  ].join('\n');

export const buildPortfolioCoverPrompt = (cards: CoverPromptCard[]): string =>
  [
    '다음 카드의 표지를 현재 과정만 근거로 작성하라. 구성이 크게 바뀌지 않았으면 제목을 유지하라.',
    '',
    cards.map(formatCard).join('\n\n'),
  ].join('\n');

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const toNaming = (value: unknown): ProjectGroupNaming | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const { key, title, summary, problem, result, highlights } = record;
  if (
    !isNonEmptyString(key) ||
    !isNonEmptyString(title) ||
    !isNonEmptyString(summary) ||
    !isNonEmptyString(problem) ||
    typeof result !== 'string'
  ) {
    return null;
  }
  return {
    key: key.trim(),
    title: title.trim(),
    summary: summary.trim(),
    problem: problem.trim(),
    result: result.trim(),
    highlights: Array.isArray(highlights)
      ? highlights.filter(isNonEmptyString).map((item) => item.trim())
      : [],
  };
};

// JSON 전체가 파손되어도 한 회차의 다른 카드 처리까지 끊지 않는다.
export const parsePortfolioCoverOutput = (
  text: string,
  allowedKeys: string[],
): ProjectGroupNaming[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObjectText(text));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return [];
  }
  const items = (parsed as Record<string, unknown>).projects;
  if (!Array.isArray(items)) {
    return [];
  }
  const allowed = new Set(allowedKeys);
  const seen = new Set<string>();
  const covers: ProjectGroupNaming[] = [];
  for (const item of items) {
    const cover = toNaming(item);
    if (!cover || !allowed.has(cover.key) || seen.has(cover.key)) {
      continue;
    }
    seen.add(cover.key);
    covers.push(cover);
  }
  return covers;
};
