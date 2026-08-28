import { Inject, Injectable, Logger } from '@nestjs/common';
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
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

interface ProfileMatchInput {
  techTags: string[];
  profileId: number | null;
}

const DEFAULT_MATCH_THRESHOLD = 60;
const DEFAULT_DETAIL_LIMIT = 20;
const DEFAULT_NOTIFY_LIMIT = 10;

// 모델을 부르지 않는다. 갭 분석은 별도 슬롯(job-feed-gap)이 맡는다 —
// 한 그룹의 잠금 시간 예산(worker-options.constant.ts LONG_RUNNING_WORKER_LOCK_DURATION_MS)이
// 모델 호출 1회분으로 산정돼 있어, 여기에 모델 호출을 얹으면 그 예산을 넘긴다. 그래서 이 task
// 는 digestGroup 없이 독립 슬롯으로 둔다(autopilot.playbook.ts).
@Injectable()
export class JobFeedAutopilotTask implements AutopilotTask {
  readonly id = 'job-feed';
  private readonly logger = new Logger(JobFeedAutopilotTask.name);

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

  async run(): Promise<AutopilotTaskResult> {
    // env 는 아직 app.config.ts 에 없다(Task 17 예정) — 미설정이면 꺼진 상태가 기본이다.
    if (this.configService.get<string>('JOB_FEED_ENABLED') !== 'true') {
      return { skip: true };
    }

    const threshold = this.readNumber(
      'JOB_FEED_MATCH_THRESHOLD',
      DEFAULT_MATCH_THRESHOLD,
    );
    const detailLimit = this.readNumber(
      'JOB_FEED_DETAIL_LIMIT',
      DEFAULT_DETAIL_LIMIT,
    );

    const collected = await this.collect.execute({});

    const profile = await this.loadProfile();
    if (profile.techTags.length === 0) {
      // 프로필이 없으면 채점 근거가 없다. 여기서 새로 만들지 않는다 —
      // 프로필 생성은 GitHub 조회와 모델 호출을 동반한다.
      return {
        skip: false,
        summaryText: `*백엔드 공고 수집* — 커리어 프로필이 없어 채점을 건너뜁니다. (수집 ${collected.upsert.created}건)`,
      };
    }

    await this.score.execute({
      techTags: profile.techTags,
      years: this.readNumberOrNull('JOB_FEED_YEARS'),
      locations: this.parseLocations(),
      profileId: profile.profileId,
    });

    await this.fetchDetail.execute({ threshold, limit: detailLimit });

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

  // env 가 아직 app.config.ts 에 선언되지 않아(Task 17) class-transformer 의
  // enableImplicitConversion 이 이 키들에 적용되지 않는다 — ConfigService.get<number>()
  // 를 믿지 않고 문자열로 읽어 직접 파싱한다.
  private readNumber(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key);
    if (raw === undefined || raw.trim().length === 0) {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      this.logger.warn(`${key} 값이 숫자가 아닙니다 — 기본값 ${fallback} 사용`);
      return fallback;
    }
    return parsed;
  }

  private readNumberOrNull(key: string): number | null {
    const raw = this.configService.get<string>(key);
    if (raw === undefined || raw.trim().length === 0) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async loadProfile(): Promise<ProfileMatchInput> {
    const profile = await this.prisma.careerProfile.findFirst({
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
