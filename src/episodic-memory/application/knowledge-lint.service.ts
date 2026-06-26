import { Injectable } from '@nestjs/common';

import {
  KnowledgeLintIssue,
  KnowledgeLintPort,
  LintEpisodicMemoryInput,
} from '../domain/port/knowledge-lint.port';
import {
  KnowledgeLintRepository,
  NearestNeighborRow,
} from '../infrastructure/knowledge-lint.repository';

// episodic-memory 무결성 점검의 판정 책임(application). repository 후보 행에 임계값/분류 규칙을 적용한다.
@Injectable()
export class KnowledgeLintService implements KnowledgeLintPort {
  constructor(private readonly repository: KnowledgeLintRepository) {}

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

    return [...duplicates, ...nullIssues];
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
