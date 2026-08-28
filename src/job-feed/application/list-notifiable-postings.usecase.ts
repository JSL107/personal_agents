import { Inject, Injectable } from '@nestjs/common';

import {
  JOB_POSTING_REPOSITORY_PORT,
  JobPostingRepositoryPort,
  StoredJobPosting,
} from '../domain/port/job-posting.repository.port';

export interface ListNotifiableInput {
  threshold: number;
  limit: number;
  // true 면 선점하지 않는다 (CLI 미리보기용).
  peek?: boolean;
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

  async execute({
    threshold,
    limit,
    peek,
    avoidSkillTags,
  }: ListNotifiableInput): Promise<StoredJobPosting[]> {
    const candidates = await this.repository.findNotifiable(
      threshold,
      limit,
      avoidSkillTags ?? [],
    );
    if (peek === true) {
      return candidates;
    }

    const claimed: StoredJobPosting[] = [];
    const seenKeys = new Set<string>();
    const now = new Date();

    for (const candidate of candidates) {
      // 같은 공고가 여러 소스로 들어오면 normalizedKey 가 같다. 한 번만 알린다.
      if (seenKeys.has(candidate.normalizedKey)) {
        continue;
      }
      seenKeys.add(candidate.normalizedKey);
      const won = await this.repository.claimForNotification(
        candidate.normalizedKey,
        now,
      );
      if (won) {
        claimed.push(candidate);
      }
    }

    return claimed;
  }
}
