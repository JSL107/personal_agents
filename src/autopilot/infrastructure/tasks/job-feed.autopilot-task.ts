import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CollectJobPostingsUsecase } from '../../../job-feed/application/collect-job-postings.usecase';
import { FetchPostingDetailUsecase } from '../../../job-feed/application/fetch-posting-detail.usecase';
import { ListNotifiablePostingsUsecase } from '../../../job-feed/application/list-notifiable-postings.usecase';
import { ScoreJobPostingsUsecase } from '../../../job-feed/application/score-job-postings.usecase';
import {
  JOB_POSTING_REPOSITORY_PORT,
  JobPostingRepositoryPort,
} from '../../../job-feed/domain/port/job-posting.repository.port';
import { formatJobFeedDigest } from '../../../job-feed/infrastructure/job-feed.formatter';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

interface ProfileMatchInput {
  techTags: string[];
  profileId: number | null;
}

// 실측 분포(228건 중 80~100:95 · 60~79:117 · 40~59:14 · 20~39:2) 기준 — 60점은
// 93%가 통과해 필터 구실을 못 한다(Task 17, .env.example JOB_FEED_MATCH_THRESHOLD=80).
const DEFAULT_MATCH_THRESHOLD = 80;
const DEFAULT_DETAIL_LIMIT = 20;
const DEFAULT_NOTIFY_LIMIT = 10;

// 모델을 부르지 않는다. 갭 분석은 별도 슬롯(job-feed-gap)이 맡는다 —
// 한 그룹의 잠금 시간 예산(worker-options.constant.ts LONG_RUNNING_WORKER_LOCK_DURATION_MS)이
// 모델 호출 1회분으로 산정돼 있어, 여기에 모델 호출을 얹으면 그 예산을 넘긴다. 그래서 이 task
// 는 digestGroup 없이 독립 슬롯으로 둔다(autopilot.playbook.ts).
@Injectable()
export class JobFeedAutopilotTask implements AutopilotTask {
  readonly id = 'job-feed';

  constructor(
    private readonly collect: CollectJobPostingsUsecase,
    private readonly score: ScoreJobPostingsUsecase,
    private readonly fetchDetail: FetchPostingDetailUsecase,
    private readonly listNotifiable: ListNotifiablePostingsUsecase,
    private readonly prisma: PrismaService,
    @Inject(JOB_POSTING_REPOSITORY_PORT)
    private readonly jobPostingRepository: JobPostingRepositoryPort,
    private readonly configService: ConfigService,
  ) {}

  async run({
    ownerSlackUserId,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    // 미설정이면 꺼진 상태가 기본이다.
    if (this.configService.get<string>('JOB_FEED_ENABLED') !== 'true') {
      return { skip: true };
    }

    const threshold =
      this.configService.get<number>('JOB_FEED_MATCH_THRESHOLD') ??
      DEFAULT_MATCH_THRESHOLD;
    const detailLimit =
      this.configService.get<number>('JOB_FEED_DETAIL_LIMIT') ??
      DEFAULT_DETAIL_LIMIT;

    const collected = await this.collect.execute({});

    const profile = await this.loadProfile(ownerSlackUserId);
    if (profile.techTags.length === 0) {
      // 프로필이 없으면 채점 근거가 없다. 여기서 새로 만들지 않는다 —
      // 프로필 생성은 GitHub 조회와 모델 호출을 동반한다.
      return {
        skip: false,
        summaryText: `*백엔드 공고 수집* — 커리어 프로필이 없어 채점을 건너뜁니다. (수집 ${collected.upsert.created}건)`,
      };
    }

    const scoreInput = {
      techTags: profile.techTags,
      years: this.configService.get<number>('JOB_FEED_YEARS') ?? null,
      locations: this.parseLocations(),
      profileId: profile.profileId,
    };

    await this.score.execute(scoreInput);

    await this.fetchDetail.execute({ threshold, limit: detailLimit });

    // fetchDetail → saveDetail 이 목록에 스킬이 없는 소스(원티드)의 skillTags 를
    // 채우면서 채점 표식(scoredProfileId·scoredAt)을 지운 행이 있을 수 있다. 여기서
    // 다시 채점하지 않으면 그 행은 최초 채점(스킬 없이 매긴 최대 65점)에 계속 머물러
    // 기준점(threshold, 기본 80)을 못 넘고 다음 날 아침에야 반영된다. 두 번째 호출은
    // findScoringTargets 가 scoredProfileId 불일치 행만 대상으로 삼으므로(saveDetail 이
    // 방금 지운 행만 해당) 비용이 작다.
    await this.score.execute(scoreInput);

    const postings = await this.listNotifiable.execute({
      threshold,
      limit: DEFAULT_NOTIFY_LIMIT,
    });

    // 조회 계층의 신선도 조건(이틀)이 걸려 있어, 수집이 며칠째 실패하면 postings 가
    // 조용히 텅 비어 "조건에 맞는 공고 없음"으로 보인다. 마지막 수집 성공 시각을
    // 각주에 남겨 그 실패 모드를 구분한다(formatJobFeedDigest 참조).
    const lastCollectedAt =
      await this.jobPostingRepository.findLastCollectedAt();

    const summaryText = formatJobFeedDigest({
      postings,
      outcomes: collected.outcomes,
      unmatchedSkillTags: collected.unmatchedSkillTags,
      lastCollectedAt,
    });

    return { skip: false, summaryText };
  }

  private parseLocations(): string[] {
    const raw = this.configService.get<string>('JOB_FEED_LOCATIONS') ?? '';
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private async loadProfile(
    ownerSlackUserId: string,
  ): Promise<ProfileMatchInput> {
    const profile = await this.prisma.careerProfile.findFirst({
      // owner 필터 없이 findFirst 만 쓰면 다른 사용자가 더 최근에 만든 프로필이 있을 때
      // 그 사람의 기술 이력으로 채점한 공고가 owner 에게 간다.
      where: { slackUserId: ownerSlackUserId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, profileJson: true },
    });
    if (profile === null) {
      return { techTags: [], profileId: null };
    }
    const data = profile.profileJson as {
      accomplishments?: Array<{ techTags?: string[] }>;
    };
    const techTags = (data.accomplishments ?? []).flatMap((item) => {
      return item.techTags ?? [];
    });
    return { techTags: [...new Set(techTags)], profileId: profile.id };
  }
}
