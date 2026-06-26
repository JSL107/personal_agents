import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import {
  CONTRADICTION_JUDGE_PORT,
  ContradictionJudgePort,
} from '../../agent/contradiction-judge/domain/contradiction-judge.port';
import { CodexQuotaExceededException } from '../../model-router/infrastructure/codex-cli.provider';
import {
  ContradictionLintOptions,
  KnowledgeLintIssue,
  KnowledgeLintPort,
  LintEpisodicMemoryInput,
} from '../domain/port/knowledge-lint.port';
import {
  KnowledgeLintRepository,
  NearestNeighborRow,
} from '../infrastructure/knowledge-lint.repository';

// episodic-memory 무결성 점검의 판정 책임(application). repository 후보 행에 임계값/분류 규칙을 적용한다.
// L4(contradiction)는 옵셔널 judge 주입 + 활성 옵션일 때만 — 미주입/비활성 시 L1/L2 만 수행.
@Injectable()
export class KnowledgeLintService implements KnowledgeLintPort {
  private readonly logger = new Logger(KnowledgeLintService.name);

  constructor(
    private readonly repository: KnowledgeLintRepository,
    @Optional()
    @Inject(CONTRADICTION_JUDGE_PORT)
    private readonly judge?: ContradictionJudgePort,
  ) {}

  async lintIssues(
    input: LintEpisodicMemoryInput,
  ): Promise<KnowledgeLintIssue[]> {
    const [neighbors, nullRows] = await Promise.all([
      this.repository.findNearestNeighbors(input.limit),
      this.repository.findEmbeddingNull(input.limit),
    ]);

    const duplicates = this.toDuplicateIssues(
      neighbors,
      input.duplicateMaxDistance,
    );
    const nullIssues = nullRows.map<KnowledgeLintIssue>((row) => ({
      type: 'embedding_null',
      episodeId: row.id,
      detail: 'embedding 누락 — 벡터 검색에서 제외됨',
      occurredAt: row.occurredAt,
    }));

    // L4 는 맨 마지막 — L1/L2(결정론, 무료) 결과를 먼저 확보. judge 미주입/비활성 시 skip(조회도 안 함).
    const contradictions =
      input.l4?.enabled && this.judge
        ? await this.detectContradictions(this.judge, input.l4)
        : [];

    return [...duplicates, ...nullIssues, ...contradictions];
  }

  // 거리 밴드 쌍을 순차로 LLM 판정. codex 쿼터 소진 시 즉시 중단(circuit break) — 끝까지 안 먹는다.
  // 그 외 judge 실패는 해당 쌍만 skip(best-effort).
  private async detectContradictions(
    judge: ContradictionJudgePort,
    l4: ContradictionLintOptions,
  ): Promise<KnowledgeLintIssue[]> {
    const pairs = await this.repository.findBandPairs({
      minDistance: l4.minDistance,
      maxDistance: l4.maxDistance,
      limit: l4.maxPairs,
    });
    const issues: KnowledgeLintIssue[] = [];
    for (const pair of pairs) {
      try {
        const verdict = await judge.judge({
          textA: pair.contentA,
          textB: pair.contentB,
        });
        if (verdict.contradiction) {
          issues.push({
            type: 'contradiction',
            episodeId: pair.idA,
            relatedId: pair.idB,
            detail: `모순 후보 — ${verdict.reason || `distance ${pair.distance.toFixed(3)}`}`,
            occurredAt: pair.occurredAt,
          });
        }
      } catch (error) {
        if (error instanceof CodexQuotaExceededException) {
          this.logger.warn(
            `L4 쿼터 소진 — 남은 쌍 판정 중단 (${error.resetHint ?? 'reset 미상'})`,
          );
          break;
        }
        this.logger.warn(
          `L4 judge 실패, 쌍 #${pair.idA}↔#${pair.idB} skip: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return issues;
  }

  // 임계값 필터 + (id, relatedId) 무순서 쌍 dedup — a→b, b→a 가 둘 다 후보로 와도 1건으로 만든다.
  private toDuplicateIssues(
    neighbors: NearestNeighborRow[],
    maxDistance: number,
  ): KnowledgeLintIssue[] {
    const seenPairs = new Set<string>();
    const issues: KnowledgeLintIssue[] = [];
    for (const row of neighbors) {
      if (row.distance > maxDistance) {
        continue;
      }
      const pairKey =
        row.id < row.relatedId
          ? `${row.id}:${row.relatedId}`
          : `${row.relatedId}:${row.id}`;
      if (seenPairs.has(pairKey)) {
        continue;
      }
      seenPairs.add(pairKey);
      issues.push({
        type: 'near_duplicate',
        episodeId: row.id,
        relatedId: row.relatedId,
        detail: `중복 후보 — distance ${row.distance.toFixed(3)}`,
        occurredAt: row.occurredAt,
      });
    }
    return issues;
  }
}
