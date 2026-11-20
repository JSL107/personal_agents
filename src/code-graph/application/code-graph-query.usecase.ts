import { Injectable } from '@nestjs/common';

import { CodeChunk } from '../domain/code-chunk.type';
import { CodeGraphSnapshot } from '../domain/code-graph.type';
import { CodeRelation } from '../domain/code-relation.type';
import {
  COMMON_TOKEN_RATIO,
  KeywordCandidate,
  tokenizeIdentifier,
} from '../domain/keyword-candidate.type';

// V3 SOTA Foundation 1.1 단계 4 — CodeGraphSnapshot 위에서 도는 4종 query.
// caller (BE-3 / BE-1 / BE-2) 가 snapshot 을 별도 빌드/로드해 인자로 전달. usecase 자체는 stateless.
//
// 단계 4 의 핵심 query 4종 + 1개 보조 (call site 위치). 추가 traversal (transitive ancestor 등) 은
// 단계 5 BE-3 통합 시 필요하면 확장.

export interface CallSite {
  filePath: string;
  line: number;
}

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
    // 모델이 식별자를 통째로 줘 소문자로 붙은 키워드(buildcodexpermissionargs)도 이름 일치로 치려고
    // 낱말을 이어 붙인 전체 이름을 함께 넣는다. 부분 연속 일치는 오탐이 늘어 넣지 않는다.
    const nameTokens = snapshot.chunks.map((chunk) => {
      const tokens = tokenizeIdentifier(chunk.name);
      // 낱말이 하나 이하면 이어 붙여도 같거나 빈 문자열이라 `--` 같은 키워드가 걸리지 않게 뺀다.
      return new Set(tokens.length > 1 ? [...tokens, tokens.join('')] : tokens);
    });
    const commonThreshold = snapshot.chunks.length * COMMON_TOKEN_RATIO;
    const usable = uniq(
      keywords.map((keyword) => keyword.toLowerCase()),
    ).filter(
      (keyword) =>
        nameTokens.filter((tokens) => tokens.has(toNameKey(keyword))).length <
        Math.max(commonThreshold, 2),
    );
    if (usable.length === 0) {
      return [];
    }
    const sourcePatterns = usable.map(
      (keyword) => new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i'),
    );

    return snapshot.chunks
      .map((chunk, index) => ({
        chunk,
        score: usable.reduce(
          (sum, keyword, keywordIndex) =>
            sum +
            (nameTokens[index].has(toNameKey(keyword)) ? 10 : 0) +
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

  // Port 인터페이스를 구현하는 Adapter class 이름들.
  // 이대리 컨벤션 (Symbol Port + class XxxAdapter implements XxxPort) 에서 portName='XxxPort'.
  findImplementersOf({
    snapshot,
    portName,
  }: {
    snapshot: CodeGraphSnapshot;
    portName: string;
  }): string[] {
    return uniq(
      filterImplements(snapshot.relations)
        .filter((r) => r.to === portName)
        .map((r) => r.from),
    );
  }

  // 함수/메서드 호출 사이트 — to 가 단순 식별자(`foo`) 또는 member 형태(`obj.foo`/`Foo.bar`) 양쪽 매칭.
  // member 매칭은 마지막 segment 비교 — `obj.foo()` 호출에서 functionName='foo' 으로 찾을 수 있게.
  findCallersOf({
    snapshot,
    functionName,
  }: {
    snapshot: CodeGraphSnapshot;
    functionName: string;
  }): CallSite[] {
    return filterCalls(snapshot.relations)
      .filter((r) => matchesCallTarget(r.to, functionName))
      .map((r) => ({ filePath: r.from, line: r.callSite.line }));
  }

  // 클래스/인터페이스를 extends 하는 자식들. interface↔interface, class↔class 모두 포함.
  findExtendersOf({
    snapshot,
    className,
  }: {
    snapshot: CodeGraphSnapshot;
    className: string;
  }): string[] {
    return uniq(
      filterExtends(snapshot.relations)
        .filter((r) => r.to === className)
        .map((r) => r.from),
    );
  }

  // import path 가 변경됐을 때 영향 받는 파일 목록.
  // 정확 매치 + prefix(서브패스) 매치 — `@prisma/client` 변경 시 `@prisma/client/runtime` 까지 포함.
  findFilesAffectedByImport({
    snapshot,
    importPath,
  }: {
    snapshot: CodeGraphSnapshot;
    importPath: string;
  }): string[] {
    return uniq(
      filterImports(snapshot.relations)
        .filter((r) => r.to === importPath || r.to.startsWith(`${importPath}/`))
        .map((r) => r.from),
    );
  }
}

const KIND_PRIORITY: Record<CodeChunk['kind'], number> = {
  method: 0,
  function: 1,
  'type-alias': 2,
  interface: 2,
  class: 3,
};

// tokenizeIdentifier 가 `_`·`-` 를 경계로 버리므로 이름 쪽과 같은 모양으로 맞춘다.
const toNameKey = (keyword: string): string => keyword.replace(/[_-]/g, '');

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const filterImplements = (
  relations: readonly CodeRelation[],
): Extract<CodeRelation, { kind: 'implements' }>[] =>
  relations.filter(
    (r): r is Extract<CodeRelation, { kind: 'implements' }> =>
      r.kind === 'implements',
  );

const filterExtends = (
  relations: readonly CodeRelation[],
): Extract<CodeRelation, { kind: 'extends' }>[] =>
  relations.filter(
    (r): r is Extract<CodeRelation, { kind: 'extends' }> =>
      r.kind === 'extends',
  );

const filterCalls = (
  relations: readonly CodeRelation[],
): Extract<CodeRelation, { kind: 'calls' }>[] =>
  relations.filter(
    (r): r is Extract<CodeRelation, { kind: 'calls' }> => r.kind === 'calls',
  );

const filterImports = (
  relations: readonly CodeRelation[],
): Extract<CodeRelation, { kind: 'imports' }>[] =>
  relations.filter(
    (r): r is Extract<CodeRelation, { kind: 'imports' }> =>
      r.kind === 'imports',
  );

// `obj.foo()` / `this.foo()` / `Foo.foo()` 모두 functionName='foo' 매칭. 단순 식별자도 매칭.
const matchesCallTarget = (target: string, functionName: string): boolean => {
  if (target === functionName) {
    return true;
  }
  return target.endsWith(`.${functionName}`);
};

const uniq = <T>(values: T[]): T[] => Array.from(new Set(values));
