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

// 콘솔 리모컨 write 표면 — 지시·승인(접수 202) + 거절(await 200).
// 모든 경로는 LoopbackOnlyGuard(loopback+토큰) 뒤에 있다.
//
// 승인이 202 인 것은 반영이 분 단위로 길기 때문이다(ConsoleWriteService.applyApproval 주석).
// 다만 지시와 달리 **접수 자체는 동기로 검증한다** — 없는 카드·남의 것·만료·중복 클릭은
// 이 응답에서 4xx 로 돌아오고, 202 는 "검증을 통과해 실행에 들어갔다" 를 뜻한다.
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
  @HttpCode(202)
  async apply(@Param('id') id: string): Promise<{ accepted: true }> {
    await this.consoleWrite.applyApproval(id);
    return { accepted: true };
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
