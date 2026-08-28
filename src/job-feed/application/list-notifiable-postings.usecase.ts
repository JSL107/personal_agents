import { Inject, Injectable } from '@nestjs/common';

import {
  JOB_POSTING_REPOSITORY_PORT,
  JobPostingRepositoryPort,
  StoredJobPosting,
} from '../domain/port/job-posting.repository.port';

export interface ListNotifiableInput {
  threshold: number;
  limit: number;
  // 알림에서 제외할 정규화된 기술명(예: 원치 않는 스택). 저장은 그대로 두고
  // 알림 후보에서만 뺀다 — repository.findNotifiable 참조.
  avoidSkillTags?: string[];
}

@Injectable()
export class ListNotifiablePostingsUsecase {
  constructor(
    @Inject(JOB_POSTING_REPOSITORY_PORT)
    private readonly repository: JobPostingRepositoryPort,
  ) {}

  // 후보만 돌려준다 — 선점(claimForNotification)은 여기서 하지 않는다. 예전엔 여기서
  // 미리 선점했는데, 실제 슬랙 발송은 호출부(orchestrator)가 나중에 하다 보니 포매팅·
  // 발송이 실패해도 선점 표식은 이미 찍혀 그 공고가 영영 다시 안 뜨는 문제가 있었다.
  // 선점은 발송이 성공한 뒤 onDelivered 안에서 한다(job-feed.autopilot-task.ts 참조) —
  // 그래야 발송 실패 시 다음 회차에 같은 공고가 다시 후보로 잡힌다.
  async execute({
    threshold,
    limit,
    avoidSkillTags,
  }: ListNotifiableInput): Promise<StoredJobPosting[]> {
    const candidates = await this.repository.findNotifiable(
      threshold,
      limit,
      avoidSkillTags ?? [],
    );

    // 같은 공고가 여러 소스로 들어오면 normalizedKey 가 같다. 카드에는 한 번만 올린다.
    const seenKeys = new Set<string>();
    const deduped: StoredJobPosting[] = [];
    for (const candidate of candidates) {
      if (seenKeys.has(candidate.normalizedKey)) {
        continue;
      }
      seenKeys.add(candidate.normalizedKey);
      deduped.push(candidate);
    }

    return deduped;
  }
}
