import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import {
  CONTRADICTION_JUDGE_PORT,
  ContradictionJudgePort,
} from '../../agent/contradiction-judge/domain/contradiction-judge.port';
import { CodexQuotaExceededException } from '../../model-router/infrastructure/codex-cli.provider';
import {
  ContradictionLintOptions,
  ContradictionLintOutcome,
  KnowledgeLintIssue,
  KnowledgeLintOutcome,
  KnowledgeLintPort,
  LintEpisodicMemoryInput,
} from '../domain/port/knowledge-lint.port';

// detectContradictions 내부 반환 — 실행 실태(ContradictionLintOutcome)에 그 회차의 이슈를 얹는다.
interface ContradictionDetection extends ContradictionLintOutcome {
  issues: KnowledgeLintIssue[];
}
import {
  KnowledgeLintPrismaRepository,
  NearestNeighborRow,
} from '../infrastructure/knowledge-lint.prisma.repository';

// near-duplicate 조회 폭주 안전망 — 판정 임계가 아니다. 최근접이웃은 행당 1개라 반환 상한이
// 곧 테이블 행 수이므로 현재 규모(2026-08-31 기준 1,700행)에서는 도달하지 않는다.
// 도달하면 duplicateTotal 이 과소 보고되므로 경고를 남긴다.
const DUPLICATE_SCAN_LIMIT = 5_000;

// episodic-memory 무결성 점검의 판정 책임(application). 임계값은 여기서 정해 조회에 넘기고,
// 돌아온 후보 행에 dedup/분류 규칙과 보고 상한을 적용한다.
// L4(contradiction)는 옵셔널 judge 주입 + 활성 옵션일 때만 — 미주입/비활성 시 L1/L2 만 수행.
@Injectable()
export class KnowledgeLintService implements KnowledgeLintPort {
  private readonly logger = new Logger(KnowledgeLintService.name);

  constructor(
    private readonly repository: KnowledgeLintPrismaRepository,
    @Optional()
    @Inject(CONTRADICTION_JUDGE_PORT)
    private readonly judge?: ContradictionJudgePort,
  ) {}

  async lintIssues(
    input: LintEpisodicMemoryInput,
  ): Promise<KnowledgeLintOutcome> {
    const [neighbors, nullRows] = await Promise.all([
      this.repository.findNearestNeighbors({
        maxDistance: input.duplicateMaxDistance,
        scanLimit: DUPLICATE_SCAN_LIMIT,
      }),
      this.repository.findEmbeddingNull(input.limit),
    ]);
    if (neighbors.length >= DUPLICATE_SCAN_LIMIT) {
      this.logger.warn(
        `near-duplicate 조회가 스캔 상한(${DUPLICATE_SCAN_LIMIT})에 도달 — 중복 총계가 과소 보고됩니다.`,
      );
    }

    // 전체 쌍을 먼저 세고 나서 자른다 — 보고 상한이 곧 실제 규모로 읽히는 것을 막기 위해
    // 잘린 목록(issues)과 총 쌍 수(duplicateTotal)를 함께 낸다.
    const allDuplicates = this.toDuplicateIssues(neighbors);
    const nullIssues = nullRows.map<KnowledgeLintIssue>((row) => ({
      type: 'embedding_null',
      episodeId: row.id,
      detail: 'embedding 누락 — 벡터 검색에서 제외됨',
      occurredAt: row.occurredAt,
    }));

    // L4 는 맨 마지막 — L1/L2(결정론, 무료) 결과를 먼저 확보. judge 미주입/비활성 시 skip(조회도 안 함).
    // null 로 남기는 것이 곧 "모순은 점검하지 않았다" 는 사실이다 — 호출자가 그것을 알아야
    // "이상 없음" 의 범위를 정직하게 말할 수 있다.
    const detection =
      input.l4?.enabled && this.judge
        ? await this.detectContradictions(this.judge, input.l4)
        : null;

    return {
      issues: [
        ...allDuplicates.slice(0, input.limit),
        ...nullIssues,
        ...(detection?.issues ?? []),
      ],
      duplicateTotal: allDuplicates.length,
      l4:
        detection === null
          ? null
          : {
              candidates: detection.candidates,
              judged: detection.judged,
              abortedByQuota: detection.abortedByQuota,
            },
    };
  }

  // 거리 밴드 쌍을 순차로 LLM 판정. codex 쿼터 소진 시 즉시 중단(circuit break) — 끝까지 안 먹는다.
  // 그 외 judge 실패는 해당 쌍만 skip(best-effort).
  //
  // 두 실패 경로 모두 "모순 0건" 과 같은 빈 결과로 수렴하므로, 판정을 끝낸 쌍 수(judged)를
  // 후보 수(candidates)와 함께 돌려준다. 이 수치가 없으면 호출자가 부분 실패를 정상 완료로
  // 착각해 "모순까지 점검했고 이상 없음" 이라고 알린다 — 점검 장애가 정상으로 위장된다.
  private async detectContradictions(
    judge: ContradictionJudgePort,
    l4: ContradictionLintOptions,
  ): Promise<ContradictionDetection> {
    const pairs = await this.repository.findBandPairs({
      minDistance: l4.minDistance,
      maxDistance: l4.maxDistance,
      limit: l4.maxPairs,
    });
    const issues: KnowledgeLintIssue[] = [];
    let judged = 0;
    let abortedByQuota = false;
    for (const pair of pairs) {
      try {
        const verdict = await judge.judge({
          textA: pair.contentA,
          textB: pair.contentB,
        });
        judged += 1;
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
          abortedByQuota = true;
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
    return { issues, candidates: pairs.length, judged, abortedByQuota };
  }

  // (id, relatedId) 무순서 쌍 dedup — a→b, b→a 가 둘 다 후보로 와도 1건으로 만든다.
  // 임계값 필터는 조회 단계(repository)에 있다 — 총 쌍 수를 세려면 잘리지 않은 목록이 필요하다.
  private toDuplicateIssues(
    neighbors: NearestNeighborRow[],
  ): KnowledgeLintIssue[] {
    const seenPairs = new Set<string>();
    const issues: KnowledgeLintIssue[] = [];
    for (const row of neighbors) {
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
