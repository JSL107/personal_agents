import { Injectable } from '@nestjs/common';

import { SessionInjectService } from '../../local-sessions/application/session-inject.service';
import type { ApplyResult } from '../../preview-gate/domain/apply-result.type';
import type { PreviewApplier } from '../../preview-gate/domain/port/preview-applier.port';
import {
  PREVIEW_KIND,
  type PreviewAction,
  type SessionInjectPreviewPayload,
} from '../../preview-gate/domain/preview-action.type';

@Injectable()
export class SessionInjectPreviewApplier implements PreviewApplier {
  readonly kind = PREVIEW_KIND.SESSION_INJECT;

  constructor(private readonly sessionInject: SessionInjectService) {}

  async apply(preview: PreviewAction): Promise<ApplyResult> {
    const payload = this.parsePayload(preview.payload);
    const result = this.sessionInject.inject(
      payload.sessionId,
      payload.instruction,
    );
    if (!result.ok) {
      return {
        message: `세션(${payload.sessionId})에 주입하지 못했습니다: ${result.reason}. 세션이 종료됐을 수 있습니다.`,
        artifacts: [],
      };
    }

    return {
      message: `세션에 작업을 주입했습니다. 다음 턴 종료 시 ${payload.prRef} 리뷰를 수행합니다.`,
      artifacts: [],
    };
  }

  private parsePayload(payload: unknown): SessionInjectPreviewPayload {
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('SessionInjectPreviewPayload 형식이 올바르지 않습니다.');
    }

    const candidate = payload as Partial<SessionInjectPreviewPayload>;
    const sourceIsValid =
      candidate.source === 'claude' || candidate.source === 'codex';
    if (
      typeof candidate.sessionId !== 'string' ||
      candidate.sessionId.trim().length === 0 ||
      !sourceIsValid ||
      typeof candidate.instruction !== 'string' ||
      candidate.instruction.trim().length === 0 ||
      typeof candidate.prRef !== 'string' ||
      candidate.prRef.trim().length === 0
    ) {
      throw new Error('SessionInjectPreviewPayload 형식이 올바르지 않습니다.');
    }

    return candidate as SessionInjectPreviewPayload;
  }
}
