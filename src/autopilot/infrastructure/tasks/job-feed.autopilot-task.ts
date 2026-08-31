import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../../../agent/career-mate/domain/port/career-profile.repository.port';
import { CollectJobPostingsUsecase } from '../../../job-feed/application/collect-job-postings.usecase';
import { FetchPostingDetailUsecase } from '../../../job-feed/application/fetch-posting-detail.usecase';
import { ListNotifiablePostingsUsecase } from '../../../job-feed/application/list-notifiable-postings.usecase';
import { ScoreJobPostingsUsecase } from '../../../job-feed/application/score-job-postings.usecase';
import { parseAvoidSkillTags } from '../../../job-feed/domain/avoid-skills';
import {
  JOB_POSTING_REPOSITORY_PORT,
  JobPostingRepositoryPort,
} from '../../../job-feed/domain/port/job-posting.repository.port';
import { formatJobFeedDigest } from '../../../job-feed/infrastructure/job-feed.formatter';
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
  private readonly logger = new Logger(JobFeedAutopilotTask.name);

  constructor(
    private readonly collect: CollectJobPostingsUsecase,
    private readonly score: ScoreJobPostingsUsecase,
    private readonly fetchDetail: FetchPostingDetailUsecase,
    private readonly listNotifiable: ListNotifiablePostingsUsecase,
    @Inject(JOB_POSTING_REPOSITORY_PORT)
    private readonly jobPostingRepository: JobPostingRepositoryPort,
    @Inject(CAREER_PROFILE_REPOSITORY_PORT)
    private readonly careerProfileRepository: CareerProfileRepositoryPort,
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
    // 알림·상세수집 두 표면이 같은 기피 목록을 써야 한다 — 상세수집만 빠뜨리면
    // 알림엔 안 뜰 공고가 상세 호출 예산(JOB_FEED_DETAIL_LIMIT)을 대신 차지한다.
    const avoidSkillTags = this.resolveAvoidSkillTags();

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

    // skipped 사유는 첫 호출 결과로 판단한다 — 두 호출 모두 같은 scoreInput 을 쓰므로
    // (profile.skillTags 가 비었는지는 techTags 로만 정해진다) skip 여부는 항상 같다.
    const scoreResult = await this.score.execute(scoreInput);

    await this.fetchDetail.execute({
      threshold,
      limit: detailLimit,
      avoidSkillTags,
    });

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
      avoidSkillTags,
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
      scoreSkipReason: scoreResult.skipped ? scoreResult.reason : null,
    });

    // 알림 선점(claimForNotification)은 발송이 성공한 뒤에만 한다. listNotifiable 은
    // 이제 후보만 돌려주고 선점하지 않는다 — 여기서 미리 선점하면 이 뒤(포매팅·전달
    // 과정)의 실패가 표식만 남기고 그 공고를 영영 다시 안 뜨게 만든다(orchestrator 의
    // onDelivered 계약 참조). 후보가 없으면 선점할 것도 없다.
    const onDelivered =
      postings.length === 0
        ? undefined
        : async (): Promise<void> => {
            const claimedAt = new Date();
            let failed = 0;
            // 발송은 이미 끝났다 — 한 건의 선점 실패로 나머지를 포기하면, 카드에는
            // 이미 나갔는데 표식만 안 남은 공고가 다음 회차에 다시 뜬다. 건별로
            // 격리해 최대한 많이 선점한다.
            for (const posting of postings) {
              try {
                await this.jobPostingRepository.claimForNotification(
                  posting.normalizedKey,
                  claimedAt,
                );
              } catch (error: unknown) {
                failed += 1;
                const message =
                  error instanceof Error ? error.message : String(error);
                this.logger.warn(
                  `job-feed 알림 선점 실패 — ${posting.normalizedKey}: ${message}`,
                );
              }
            }
            if (failed > 0) {
              this.logger.warn(
                `job-feed 알림 선점 — ${postings.length}건 중 ${failed}건 실패, 다음 회차에 재알림될 수 있음`,
              );
            }
          };

    return { skip: false, summaryText, onDelivered };
  }

  private parseLocations(): string[] {
    const raw = this.configService.get<string>('JOB_FEED_LOCATIONS') ?? '';
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  // 사전에 없는 값(예: 오탈자·미등록 기술)을 넣으면 그 항목이 조용히 무시돼 필터가
  // 통째로 무효가 될 수 있다 — 이 레포가 반복해 겪은 "조용한 0건" 계열이라 로그를
  // 남긴다. job-feed-gap.autopilot-task.ts 도 같은 파싱을 쓰므로 도메인 계층
  // 공용 함수(parseAvoidSkillTags)로 뺐다.
  private resolveAvoidSkillTags(): string[] {
    const { identified, unmatched, dropped } = parseAvoidSkillTags(
      this.configService.get<string>('JOB_FEED_AVOID_SKILLS'),
    );
    if (unmatched.length > 0) {
      this.logger.warn(
        `JOB_FEED_AVOID_SKILLS 중 사전에 없는 항목(표기가 정확히 같은 공고만 걸린다): ${unmatched.join(', ')}`,
      );
    }
    if (dropped.length > 0) {
      this.logger.warn(
        `JOB_FEED_AVOID_SKILLS 중 기술이 아니라 걸러지지 않는 항목: ${dropped.join(', ')}`,
      );
    }
    return identified;
  }

  private async loadProfile(
    ownerSlackUserId: string,
  ): Promise<ProfileMatchInput> {
    // 포트가 이미 slackUserId 단위로 최신 1건만 돌려준다(findLatestBySlackUser) —
    // 다른 사용자가 더 최근에 만든 프로필로 채점하는 사고는 포트 계약상 나지 않는다.
    const profile =
      await this.careerProfileRepository.findLatestBySlackUser(
        ownerSlackUserId,
      );
    if (profile === null) {
      return { techTags: [], profileId: null };
    }
    // profileJson 은 DB JSON 컬럼을 CareerProfileData 로 캐스팅한 값이라 타입
    // 보장이 런타임 보장은 아니다 — accomplishments 자체나 개별 techTags 가 없는
    // 행이 오면 `?? []` 가 없을 때 TypeError 로 task 전체가 죽는다.
    const techTags = (profile.profileJson.accomplishments ?? []).flatMap(
      (item) => {
        return item.techTags ?? [];
      },
    );
    return { techTags: [...new Set(techTags)], profileId: profile.id };
  }
}
