import { Injectable } from '@nestjs/common';

import { CodeChunk } from '../domain/code-chunk.type';
import { CodeGraphSnapshot } from '../domain/code-graph.type';
import {
  COMMON_TOKEN_RATIO,
  KeywordCandidate,
  tokenizeIdentifier,
} from '../domain/keyword-candidate.type';

// V3 SOTA Foundation 1.1 단계 4 — CodeGraphSnapshot 위에서 도는 키워드 검색. 공부 적용 판정이 유일한 사용처다.
// caller 가 snapshot 을 빌드해 인자로 전달. usecase 자체는 stateless.

@Injectable()
export class CodeGraphQueryUsecase {
  findChunksByKeywords({
    snapshot,
    keywords,
    limit,
  }: {
    snapshot: CodeGraphSnapshot;
    keywords: readonly string[];
    limit: number;
  }): KeywordCandidate[] {
    const nameTokens = snapshot.chunks.map((chunk) =>
      tokenizeIdentifier(chunk.name),
    );
    // 모델이 식별자를 통째로 줘 소문자로 붙은 키워드(buildcodexpermissionargs)도 이름 일치로 치려고
    // 낱말을 이어 붙인 전체 이름을 점수용 집합에만 넣는다. 부분 연속 일치는 아래 runHits 가 맡는다.
    // 낱말이 하나 이하면 이어 붙여도 같거나 빈 문자열이라 `--` 같은 키워드가 걸리지 않게 뺀다.
    const nameKeys = nameTokens.map(
      (tokens) =>
        new Set(tokens.length > 1 ? [...tokens, tokens.join('')] : tokens),
    );
    const tokenSets = nameTokens.map((tokens) => new Set(tokens));
    const commonLimit = Math.max(
      snapshot.chunks.length * COMMON_TOKEN_RATIO,
      2,
    );
    // 흔한 "낱말" 만 뺀다. 전체 이름까지 세면 작은 스냅샷에서 이전에 본문으로 찾던 키워드가 사라진다.
    // 원래 표기는 연속 낱말 일치에 쓰려고 남긴다(소문자 기준 첫 표기).
    const usable = keywords
      .filter(
        (keyword, index) =>
          keywords.findIndex(
            (other) => other.toLowerCase() === keyword.toLowerCase(),
          ) === index,
      )
      .filter(
        (keyword) =>
          tokenSets.filter((tokens) => tokens.has(keyword.toLowerCase()))
            .length < commonLimit,
      );
    if (usable.length === 0) {
      return [];
    }
    const sourcePatterns = usable.map(
      (keyword) => new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i'),
    );
    // 원문 키워드의 낱말이 이름 낱말에 순서대로 붙어 있으면(priorTurns ↔ getPriorTurnsWithChannelFallback)
    // 이름 일치로 친다. 낱말 하나짜리는 위 낱말 일치와 같으므로 뺀다. 2% 이상 조각에 걸리면 이 키워드의
    // 연속 일치만 끈다. 소문자로 붙은 옛 키워드(priorturns)는 낱말이 하나라 걸리지 않고, 밑줄로 이은 것은 걸린다.
    const runHits = usable.map((keyword) => {
      const run = tokenizeIdentifier(keyword);
      if (run.length < 2) {
        return new Set<number>();
      }
      const hits = new Set(
        nameTokens.flatMap((tokens, index) =>
          containsRun({ tokens, run }) ? [index] : [],
        ),
      );
      return hits.size < commonLimit ? hits : new Set<number>();
    });

    return snapshot.chunks
      .map((chunk, index) => ({
        chunk,
        score: usable.reduce(
          (sum, keyword, keywordIndex) =>
            sum +
            (nameKeys[index].has(toNameKey(keyword.toLowerCase())) ||
            runHits[keywordIndex].has(index)
              ? 10
              : 0) +
            (sourcePatterns[keywordIndex].test(chunk.source) ? 1 : 0),
          0,
        ),
      }))
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          KIND_PRIORITY[left.chunk.kind] - KIND_PRIORITY[right.chunk.kind] ||
          left.chunk.filePath.localeCompare(right.chunk.filePath) ||
          left.chunk.startLine - right.chunk.startLine,
      )
      .slice(0, limit)
      .map(({ chunk, score }, index) => ({
        ...chunk,
        id: `c${index + 1}`,
        score,
      }));
  }
}

const KIND_PRIORITY: Record<CodeChunk['kind'], number> = {
  method: 0,
  function: 1,
  'type-alias': 2,
  interface: 2,
  class: 3,
};

const containsRun = ({
  tokens,
  run,
}: {
  tokens: string[];
  run: string[];
}): boolean =>
  tokens.some((_, start) =>
    run.every((token, offset) => tokens[start + offset] === token),
  );

// tokenizeIdentifier 가 `_`·`-` 를 경계로 버리므로 이름 쪽과 같은 모양으로 맞춘다.
const toNameKey = (keyword: string): string => keyword.replace(/[_-]/g, '');

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
