import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AgentType } from '../../model-router/domain/model-router.type';
import { ConsoleWriteService } from '../application/console-write.service';
import { ConsoleWriteGuard } from './console-write.guard';
import { ConsoleCommandDto } from './dto/console-command.dto';

// 콘솔 리모컨 write 표면 — 지시(fire-and-forget 202) + 승인/거절(await 200).
// 모든 경로는 ConsoleWriteGuard(loopback+토큰) 뒤에 있다.
@Controller('v1/console')
@UseGuards(ConsoleWriteGuard)
export class ConsoleWriteController {
  constructor(private readonly consoleWrite: ConsoleWriteService) {}

  @Post('command')
  @HttpCode(202)
  sendCommand(@Body() dto: ConsoleCommandDto): { accepted: true } {
    this.consoleWrite.sendCommand({
      text: dto.text,
      agentTypeHint: dto.agentTypeHint as AgentType | undefined,
      commandId: dto.commandId,
    });
    return { accepted: true };
  }

  @Post('approvals/:id/apply')
  async apply(@Param('id') id: string): Promise<{ ok: true }> {
    await this.consoleWrite.applyApproval(id);
    return { ok: true };
  }

  @Post('approvals/:id/cancel')
  async cancel(@Param('id') id: string): Promise<{ ok: true }> {
    await this.consoleWrite.cancelApproval(id);
    return { ok: true };
  }
}
