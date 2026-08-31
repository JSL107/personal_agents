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
      const next = normalizeSkillTags(row.rawSkillTags).identified;
      if (this.isSame(row.skillTags, next)) {
        continue;
      }
      // 🔴 contentHash 는 일부러 건드리지 않는다. 이 저장소에서 지문의 주인은 수집이다 —
      // upsertMany 의 listOnlyFields 가 매 수집마다 지문을 목록 기준으로 덮어쓰고,
      // 상세를 받은 행(원티드는 목록에 스킬이 없어 상세로 채운다)도 지문만은 목록
      // 기준으로 유지한다. 여기서 상세 태그로 지문을 다시 찍으면 다음 목록 수집의
      // 지문과 어긋나 upsertMany 가 "요건 변경" 으로 오인하고 notifiedAt 을 지운다 —
      // 이미 발송한 공고가 다시 알림된다. 실측(2026-08-31) 상세 수집된 행이 247건 중
      // 82건(원티드 62·점핏 20)이라 영향 범위가 작지 않다.
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
