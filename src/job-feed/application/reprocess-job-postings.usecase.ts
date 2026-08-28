import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  JOB_POSTING_REPOSITORY_PORT,
  JobPostingRepositoryPort,
} from '../domain/port/job-posting.repository.port';
import { normalizeSkillTags } from '../domain/skill-dictionary';

export interface ReprocessOutcome {
  examined: number;
  changed: number;
}

// 사전을 고친 뒤 과거 행을 되살린다. 이게 없으면 rawSkillTags 는 읽는 곳이 없는 죽은 필드가 된다.
@Injectable()
export class ReprocessJobPostingsUsecase {
  private readonly logger = new Logger(ReprocessJobPostingsUsecase.name);

  constructor(
    @Inject(JOB_POSTING_REPOSITORY_PORT)
    private readonly repository: JobPostingRepositoryPort,
  ) {}

  async execute(): Promise<ReprocessOutcome> {
    const rows = await this.repository.findAllForReprocess();
    let changed = 0;

    for (const row of rows) {
      const next = normalizeSkillTags(row.rawSkillTags).matched;
      if (this.isSame(row.skillTags, next)) {
        continue;
      }
      await this.repository.saveSkillTags(row.id, next);
      changed += 1;
    }

    this.logger.log(
      `job-feed 재파생 — 대상 ${rows.length}건 중 ${changed}건 갱신`,
    );
    return { examined: rows.length, changed };
  }

  private isSame(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => value === right[index]);
  }
}
