import { Inject, Injectable, Logger } from '@nestjs/common';

import { NormalizedJobPosting } from '../domain/job-feed.type';
import { buildMatchProfile, scorePosting } from '../domain/match-score';
import {
  JOB_POSTING_REPOSITORY_PORT,
  JobPostingRepositoryPort,
  StoredJobPosting,
} from '../domain/port/job-posting.repository.port';

export interface ScoreInput {
  techTags: string[];
  years: number | null;
  locations: string[];
  profileId: number | null;
}

export interface ScoreOutcome {
  scored: number;
  skipped: boolean;
  reason: string | null;
  // 0-19, 20-39, … 구간별 건수. 전부 최저 구간이면 매칭이 안 되고 있다는 신호다.
  histogram: Record<string, number>;
  profileTokenCount: number;
}

const BUCKET_SIZE = 20;

const toBucketLabel = (score: number): string => {
  const lower = Math.min(80, Math.floor(score / BUCKET_SIZE) * BUCKET_SIZE);
  return `${lower}-${lower + BUCKET_SIZE - 1}`;
};

// 모델을 부르지 않는 결정론 계산기라 AgentRunService(원장)를 쓰지 않는다 — 이 레포의
// screener/paper-trading/collect-job-postings 와 같은 방식으로 logger.log() 에 분포를 남긴다.
@Injectable()
export class ScoreJobPostingsUsecase {
  private readonly logger = new Logger(ScoreJobPostingsUsecase.name);

  constructor(
    @Inject(JOB_POSTING_REPOSITORY_PORT)
    private readonly repository: JobPostingRepositoryPort,
  ) {}

  async execute({
    techTags,
    years,
    locations,
    profileId,
  }: ScoreInput): Promise<ScoreOutcome> {
    const profile = buildMatchProfile({ techTags, years, locations });

    // 프로필 기술이 없으면 매길 근거가 없다. 0점으로 채우면 "조건에 안 맞음" 과 구분되지 않는다.
    if (profile.skillTags.length === 0) {
      const reason =
        '커리어 프로필에 사전과 맞는 기술 태그가 없어 채점을 건너뜁니다.';
      this.logger.warn(`job-feed 채점 skip — ${reason}`);
      return {
        scored: 0,
        skipped: true,
        reason,
        histogram: {},
        profileTokenCount: 0,
      };
    }

    const targets = await this.repository.findScoringTargets(profileId);
    const histogram: Record<string, number> = {};

    for (const target of targets) {
      const breakdown = scorePosting(this.toNormalized(target), profile);
      await this.repository.saveScore({
        id: target.id,
        matchScore: breakdown.score,
        scoredProfileId: profileId,
      });
      const label = toBucketLabel(breakdown.score);
      histogram[label] = (histogram[label] ?? 0) + 1;
    }

    this.logger.log(
      `job-feed 채점 — ${targets.length}건, 분포 ${JSON.stringify(histogram)}`,
    );

    return {
      scored: targets.length,
      skipped: false,
      reason: null,
      histogram,
      profileTokenCount: profile.skillTags.length,
    };
  }

  // 저장된 행을 점수 계산이 요구하는 형태로 좁힌다. 계산에 쓰지 않는 필드는 기본값으로 채운다 —
  // skillTags·minYears·maxYears·locations 는 점수에 직접 쓰이므로 원본 값을 그대로 넘긴다.
  private toNormalized(stored: StoredJobPosting): NormalizedJobPosting {
    return {
      source: stored.source as NormalizedJobPosting['source'],
      sourceId: stored.sourceId,
      company: stored.company,
      companyKey: '',
      title: stored.title,
      detailUrl: stored.detailUrl,
      skillTags: stored.skillTags,
      rawSkillTags: stored.rawSkillTags,
      minYears: stored.minYears,
      maxYears: stored.maxYears,
      yearsSource: 'RANGE',
      rawJobLevel: null,
      experienceLevel:
        (stored.experienceLevel as NormalizedJobPosting['experienceLevel']) ??
        'any',
      locations: stored.locations,
      rawLocations: [],
      normalizedKey: stored.normalizedKey,
      contentHash: '',
    };
  }
}
