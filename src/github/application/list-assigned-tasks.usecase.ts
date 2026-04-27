import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { resolveStaleDataCutoff } from '../../common/util/stale-data-cutoff.util';
import { AssignedTasks } from '../domain/github.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
  ListAssignedTasksOptions,
} from '../domain/port/github-client.port';

// 사용자에게 assigned 된 open issue/PR 을 GitHub 에서 한 번에 조회한다.
// PM Agent 의 `/today` 에서 자동 evidence 수집 입력으로 활용 (Phase 2b).
// OPS-6: 호출자가 updatedSinceIsoDate 를 명시 안 하면 STALE_DATA_CUTOFF_DAYS env 기반 컷오프를 자동 적용 —
// 사용자가 archive 안 한 long-tail open issue 가 매일 prompt 에 누적되는 것을 차단.
@Injectable()
export class ListAssignedTasksUsecase {
  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    private readonly configService: ConfigService,
  ) {}

  async execute(options?: ListAssignedTasksOptions): Promise<AssignedTasks> {
    const cutoff = resolveStaleDataCutoff({
      configService: this.configService,
    });
    return this.githubClient.listMyAssignedTasks({
      ...options,
      updatedSinceIsoDate: options?.updatedSinceIsoDate ?? cutoff.isoDate,
    });
  }
}
