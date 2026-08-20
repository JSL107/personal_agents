import { Controller, Get } from '@nestjs/common';

import { BuildPresidentBriefingUsecase } from '../application/build-president-briefing.usecase';
import { ConsoleReadService } from '../application/console-read.service';
import { ConsoleBriefing } from '../domain/briefing.type';
import {
  ConsoleAgent,
  ConsoleApproval,
  ConsoleRun,
  ConsoleSnapshot,
} from '../domain/console.type';

// 콘솔 관제 REST 표면 — 전부 읽기 전용. 앱은 부팅 시 snapshot 1콜 후 SSE 로 갱신하고,
// agents/runs/approvals 는 디버그·부분 재조회용이다.
@Controller('v1/console')
export class ConsoleController {
  constructor(
    private readonly consoleRead: ConsoleReadService,
    private readonly buildBriefing: BuildPresidentBriefingUsecase,
  ) {}

  // 대표 브리핑 — 오늘의 할 일·연속 기록·퇴근 정산. 스냅샷과 갱신 주기가 달라 따로 둔다.
  @Get('briefing')
  async getBriefing(): Promise<ConsoleBriefing> {
    return await this.buildBriefing.execute();
  }

  @Get('snapshot')
  async getSnapshot(): Promise<ConsoleSnapshot> {
    return await this.consoleRead.getSnapshot();
  }

  @Get('agents')
  async getAgents(): Promise<ConsoleAgent[]> {
    const snapshot = await this.consoleRead.getSnapshot();
    return snapshot.agents;
  }

  @Get('runs')
  async getRuns(): Promise<ConsoleRun[]> {
    const snapshot = await this.consoleRead.getSnapshot();
    return snapshot.runs;
  }

  @Get('approvals')
  async getApprovals(): Promise<ConsoleApproval[]> {
    const snapshot = await this.consoleRead.getSnapshot();
    return snapshot.approvals;
  }
}
