import { Inject, Injectable, Logger } from '@nestjs/common';

import { supportsDetail } from '../domain/port/job-detail-source.port';
import {
  JOB_POSTING_REPOSITORY_PORT,
  JobPostingRepositoryPort,
} from '../domain/port/job-posting.repository.port';
import { JOB_SOURCES, JobSourcePort } from '../domain/port/job-source.port';
import { normalizeSkillTags } from '../domain/skill-dictionary';
import { DETAIL_REQUEST_DELAY_MS } from '../infrastructure/http-constants';

export interface FetchDetailInput {
  threshold: number;
  limit: number;
}

export interface FetchDetailOutcome {
  attempted: number;
  updated: number;
  failed: number;
  skippedNoDetailSupport: number;
}

const DETAIL_STALE_MS = 24 * 60 * 60 * 1000;

const sleep = (milliseconds: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
};

// 본문은 모든 행에 채우지 않는다. 점핏 48 + 랠릿 300 + 원티드 120 이면 첫 실행에
// 상세 호출이 400 회를 넘는다. 채점 상위 후보만, 상한과 간격을 두고 가져온다.
@Injectable()
export class FetchPostingDetailUsecase {
  private readonly logger = new Logger(FetchPostingDetailUsecase.name);

  constructor(
    @Inject(JOB_SOURCES) private readonly sources: JobSourcePort[],
    @Inject(JOB_POSTING_REPOSITORY_PORT)
    private readonly repository: JobPostingRepositoryPort,
  ) {}

  async execute({
    threshold,
    limit,
  }: FetchDetailInput): Promise<FetchDetailOutcome> {
    const staleBefore = new Date(Date.now() - DETAIL_STALE_MS);
    const targets = await this.repository.findDetailTargets(
      threshold,
      limit,
      staleBefore,
    );

    let updated = 0;
    let failed = 0;
    let skippedNoDetailSupport = 0;
    // 배열 인덱스가 아니라 실제 HTTP 호출 횟수로 센다. 상세 미지원 소스(랠릿)는
    // 호출 없이 건너뛰는데, 인덱스로 세면 건너뛴 항목 뒤 첫 실제 호출이
    // `index > 0` 에 걸려 불필요하게 지연을 기다리게 된다.
    let attempted = 0;

    for (const target of targets) {
      const source = this.sources.find((candidate) => {
        return candidate.source === target.source;
      });
      if (source === undefined || !supportsDetail(source)) {
        skippedNoDetailSupport += 1;
        continue;
      }

      if (attempted > 0) {
        await sleep(DETAIL_REQUEST_DELAY_MS);
      }
      attempted += 1;

      try {
        const detail = await source.fetchDetail(target.sourceId);
        // 원티드는 목록에 스킬이 없어 상세에서 처음 채워진다. 이미 있으면 그대로 둔다.
        const rawSkillTags =
          detail.rawSkillTags.length > 0
            ? detail.rawSkillTags
            : target.rawSkillTags;
        await this.repository.saveDetail({
          id: target.id,
          jdText: detail.jdText,
          skillTags: normalizeSkillTags(rawSkillTags).matched,
          rawSkillTags,
        });
        updated += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `job-feed 상세 수집 실패 — ${target.source}:${target.sourceId} ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    this.logger.log(
      `job-feed 상세 — 시도 ${targets.length} 갱신 ${updated} 실패 ${failed} 미지원 ${skippedNoDetailSupport}`,
    );

    return {
      attempted: targets.length,
      updated,
      failed,
      skippedNoDetailSupport,
    };
  }
}
