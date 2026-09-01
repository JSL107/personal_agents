import { Controller, Get, UseGuards } from '@nestjs/common';

import { BuildLedgerUsecase } from '../application/build-ledger.usecase';
import { BuildPresidentBriefingUsecase } from '../application/build-president-briefing.usecase';
import { ConsoleReadService } from '../application/console-read.service';
import { ConsoleBriefing } from '../domain/briefing.type';
import {
  ConsoleAgent,
  ConsoleApproval,
  ConsoleRun,
  ConsoleSnapshot,
} from '../domain/console.type';
import { ConsoleLedger } from '../domain/ledger.type';
import { ConsoleReadGuard } from './console-read.guard';

// 콘솔 관제 REST 표면 — 전부 읽기 전용. 앱은 부팅 시 snapshot 1콜 후 SSE 로 갱신하고,
// agents/runs/approvals 는 디버그·부분 재조회용이다.
//
// 읽기 전용이지만 무인증은 아니다 — 스냅샷에 세션 cwd·pid 가 담겨 원격에는 토큰을 요구한다
// (ConsoleReadGuard). loopback 은 그대로 통과하므로 맥 앱·serve.py 는 영향받지 않는다.
@Controller('v1/console')
@UseGuards(ConsoleReadGuard)
export class ConsoleController {
  constructor(
    private readonly consoleRead: ConsoleReadService,
    private readonly buildBriefing: BuildPresidentBriefingUsecase,
    private readonly buildLedger: BuildLedgerUsecase,
  ) {}

  @Get('ledger')
  async getLedger(): Promise<ConsoleLedger> {
    return await this.buildLedger.execute();
  }

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
