import { Inject, Injectable } from '@nestjs/common';

import {
  MEMORY_VACUUM_PORT,
  MemoryVacuumPort,
} from '../../../memory-vacuum/domain/port/memory-vacuum.port';
import { formatMemoryVacuum } from '../../../slack/format/memory-vacuum.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 주간 세션 기억 색인 청소 — 프로젝트별 MEMORY.md 의 색인 누락·죽은 링크·크기 초과를
// 결정론으로 고친다(LLM 0). 묶음·폐기는 의미 판단이라 하지 않고 후보만 보고한다.
//
// 파일을 쓰지만 T0_AUTO 다: 손실 없는 작업(누락 등록·죽은 줄 제거)과 원본이 파일 본문에
// 남는 작업(설명 절단)만 하고, 쓰기 전에 색인을 백업하며, 백업이 실패하면 쓰지 않는다.
// 승인 카드를 매주 띄우면 정작 사람이 판단해야 할 묶음 제안이 그 소음에 묻힌다.
@Injectable()
export class MemoryVacuumAutopilotTask implements AutopilotTask {
  readonly id = 'memory-vacuum';

  constructor(
    @Inject(MEMORY_VACUUM_PORT)
    private readonly memoryVacuum: MemoryVacuumPort,
  ) {}

  async run({
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const outcome = await this.memoryVacuum.run({ apply: true });
    return {
      skip: false,
      summaryText: formatMemoryVacuum(outcome, firedAtKst),
    };
  }
}
