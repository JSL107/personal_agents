import { Module } from '@nestjs/common';

import { RunSandboxUsecase } from './application/run-sandbox.usecase';
import { SANDBOX_RUNNER_PORT } from './domain/port/sandbox-runner.port';
import { DockerSandboxRunner } from './infrastructure/docker-sandbox-runner';

@Module({
  providers: [
    { provide: SANDBOX_RUNNER_PORT, useClass: DockerSandboxRunner },
    RunSandboxUsecase,
  ],
  exports: [SANDBOX_RUNNER_PORT, RunSandboxUsecase],
})
export class SandboxModule {}
