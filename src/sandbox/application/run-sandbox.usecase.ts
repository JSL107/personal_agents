import { Inject, Injectable } from '@nestjs/common';

import {
  SANDBOX_RUNNER_PORT,
  SandboxRunnerPort,
  SandboxRunRequest,
  SandboxRunResult,
} from '../domain/port/sandbox-runner.port';

// 향후 multi-runner 라우팅 / 실행 통계 수집을 위한 indirection 자리.
// 현재는 runner 에 단순 위임 — validation 은 runner(DockerSandboxRunner) 가 책임.
@Injectable()
export class RunSandboxUsecase {
  constructor(
    @Inject(SANDBOX_RUNNER_PORT)
    private readonly runner: SandboxRunnerPort,
  ) {}

  async execute(req: SandboxRunRequest): Promise<SandboxRunResult> {
    return this.runner.run(req);
  }
}
