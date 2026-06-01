import { Inject, Injectable } from '@nestjs/common';

import {
  AGENT_RUN_REPOSITORY_PORT,
  AgentRunRepositoryPort,
  SearchAgentRunRow,
} from '../domain/port/agent-run.repository.port';

// /search-runs 의 결과 한 줄. UI (Slack mrkdwn) 직접 의존 X — formatter 가 별도.
export interface SearchAgentRunsResultRow {
  id: number;
  agentType: string;
  endedAt: Date;
  snippet: string; // 매칭 컨텍스트 앞뒤 발췌 (가독성용).
}

export interface SearchAgentRunsResult {
  keyword: string;
  rows: SearchAgentRunsResultRow[];
  truncated: boolean; // 더 있을 가능성 (rows.length === limit).
}

// /search-runs <키워드> — 본인 SUCCEEDED AgentRun 의 output / inputSnapshot 에 키워드 ILIKE 매칭.
// 결과는 최근순 + 키워드 주변 발췌 (사용자가 어떤 plan/리뷰였는지 즉시 식별).
// LLM 호출 0 — 순수 DB 조회 + 문자열 가공.
@Injectable()
export class SearchAgentRunsUsecase {
  // Slack section.text 3000 글자 제한 + 각 row 발췌 약 150 자 가정 → 10건 한도.
  // 더 보고 싶다면 사용자가 키워드를 더 좁히면 된다.
  static readonly DEFAULT_LIMIT = 10;
  // 발췌 시 키워드 주변 컨텍스트 한쪽 글자 수.
  static readonly SNIPPET_RADIUS = 80;

  constructor(
    @Inject(AGENT_RUN_REPOSITORY_PORT)
    private readonly repository: AgentRunRepositoryPort,
  ) {}

  async execute({
    slackUserId,
    keyword,
    limit = SearchAgentRunsUsecase.DEFAULT_LIMIT,
  }: {
    slackUserId: string;
    keyword: string;
    limit?: number;
  }): Promise<SearchAgentRunsResult> {
    const rows = await this.repository.searchByKeyword({
      slackUserId,
      keyword,
      limit,
    });
    return {
      keyword,
      rows: rows.map((row) => ({
        id: row.id,
        agentType: row.agentType,
        endedAt: row.endedAt,
        snippet: buildSnippet({ row, keyword }),
      })),
      truncated: rows.length === limit,
    };
  }
}

// 매칭 위치 주변 컨텍스트 발췌 — output 우선, 없으면 inputSnapshot.
// 키워드가 양쪽 어디에도 없을 수도 있다 (case 차이 / JSON escape 등) — 그 경우 앞 N 글자만.
const buildSnippet = ({
  row,
  keyword,
}: {
  row: SearchAgentRunRow;
  keyword: string;
}): string => {
  const candidates = [row.output, row.inputSnapshot]
    .map((value) => (value === null || value === undefined ? '' : safeStringify(value)))
    .filter((text) => text.length > 0);

  const radius = SearchAgentRunsUsecase.SNIPPET_RADIUS;
  for (const text of candidates) {
    const index = text.toLowerCase().indexOf(keyword.toLowerCase());
    if (index === -1) {
      continue;
    }
    const start = Math.max(0, index - radius);
    const end = Math.min(text.length, index + keyword.length + radius);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < text.length ? '…' : '';
    return collapseWhitespace(`${prefix}${text.slice(start, end)}${suffix}`);
  }

  // fallback — 키워드 일치가 없어도 (예: 유니코드 escape 차이) row 식별을 위한 앞 N 글자.
  const head = candidates[0] ?? '';
  return collapseWhitespace(head.slice(0, radius * 2));
};

const safeStringify = (value: unknown): string => {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const collapseWhitespace = (text: string): string =>
  text.replace(/\s+/g, ' ').trim();
