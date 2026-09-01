import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { LoopbackOnlyGuard } from '../../common/guard/loopback-only.guard';
import { SessionInjectService } from '../../local-sessions/application/session-inject.service';
import { AgentType } from '../../model-router/domain/model-router.type';
import { ConsoleWriteService } from '../application/console-write.service';
import { ConsoleCommandDto } from './dto/console-command.dto';
import { SessionInjectDto } from './dto/session-inject.dto';

// 콘솔 리모컨 write 표면 — 지시(fire-and-forget 202) + 승인/거절(await 200).
// 모든 경로는 LoopbackOnlyGuard(loopback+토큰) 뒤에 있다.
@Controller('v1/console')
@UseGuards(LoopbackOnlyGuard)
export class ConsoleWriteController {
  constructor(
    private readonly consoleWrite: ConsoleWriteService,
    private readonly sessionInject: SessionInjectService,
  ) {}

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

  @Post('sessions/:sessionId/inject')
  @HttpCode(202)
  injectToSession(
    @Param('sessionId') sessionId: string,
    @Body() dto: SessionInjectDto,
  ): { ok: true; deliver: 'next-stop' } {
    const result = this.sessionInject.inject(sessionId, dto.text);
    if (!result.ok) {
      if (result.reason === 'EMPTY_INSTRUCTION') {
        throw new BadRequestException(result.reason);
      }
      throw new NotFoundException(result.reason);
    }
    return { ok: true, deliver: 'next-stop' };
  }
}
