import { Inject, Injectable, Optional } from '@nestjs/common';

import { ConsoleEventBus } from '../../console/application/console-event-bus.service';
import { toConsoleApproval } from '../../console/application/console-mappers';
import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';
import {
  CreatePreviewInput,
  PreviewAction,
} from '../domain/preview-action.type';

// PO-2: 새 PreviewAction 을 PENDING 상태로 만든다. 호출자 (PM-2 Write-back 등) 가 받은 PreviewAction
// id 를 Block Kit button value 로 박아 사용자에게 ✅ apply / ❌ cancel 보여준다.
@Injectable()
export class CreatePreviewUsecase {
  constructor(
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly repository: PreviewActionRepositoryPort,
    // 콘솔 관제 — ConsoleEventBusModule(@Global) 이 production 에 항상 주입. 미주입 시 emit no-op.
    @Optional()
    private readonly consoleEvents?: ConsoleEventBus,
  ) {}

  async execute(input: CreatePreviewInput): Promise<PreviewAction> {
    const created = await this.repository.create(input);
    // 콘솔 관제 — 승인 대기 발생 알림.
    this.consoleEvents?.publish({
      type: 'approval.opened',
      approval: toConsoleApproval(created),
    });
    return created;
  }
}
