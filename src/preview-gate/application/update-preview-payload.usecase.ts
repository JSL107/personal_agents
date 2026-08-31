import { Inject, Injectable } from '@nestjs/common';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';
import { PreviewActionException } from '../domain/preview-action.exception';
import { PREVIEW_STATUS, PreviewAction } from '../domain/preview-action.type';
import { PreviewActionErrorCode } from '../domain/preview-action-error-code.enum';
import { ApplyPreviewUsecase } from './apply-preview.usecase';

// 아직 승인되지 않은 카드의 내용을 사용자가 카드 위에서 고칠 때 쓴다
// (예: CTO 분배 카드의 worker 드롭다운). 승인 대상 자체를 바꾸는 조작이므로
// apply/cancel 과 같은 수준의 검증 — 소유자 일치 + PENDING + 미만료 — 을 건다.
//
// 새 payload 를 통째로 받지 않고 갱신 함수를 받는다. 카드 조작은 대개 "현재 값에서
// 한 항목만 바꾸기" 라, 호출자가 현재 payload 를 따로 읽어오면 그 조회와 저장 사이가
// 벌어진다. 조회·검증·변환·저장을 한 호출로 묶어 그 틈을 없앤다.
@Injectable()
export class UpdatePreviewPayloadUsecase {
  constructor(
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly repository: PreviewActionRepositoryPort,
    private readonly applyPreview: ApplyPreviewUsecase,
  ) {}

  // previewId 별 직렬화 사슬. read-modify-write 라 같은 카드에 대한 갱신이 겹치면 둘 다 같은
  // payload 를 읽고 각자 한 항목만 고쳐 저장해, 나중 write 가 앞선 변경을 조용히 덮는다
  // (경력 카드의 두 입력칸에 연달아 Enter, 분배 카드의 드롭다운 두 개를 빠르게 바꾸는 경우).
  // 여기서만 막으면 payload 를 고치는 모든 경로가 함께 안전해진다.
  //
  // ponytail: 단일 프로세스 전제의 인메모리 직렬화다. 인스턴스를 여러 개 띄우게 되면
  // payload 에 version 을 두고 DB CAS 로 올려야 한다.
  private readonly chains = new Map<string, Promise<unknown>>();

  async execute(input: {
    previewId: string;
    slackUserId: string;
    update: (current: unknown) => unknown;
    now?: Date;
  }): Promise<PreviewAction> {
    const previous = this.chains.get(input.previewId) ?? Promise.resolve();
    // 앞 갱신이 실패해도 뒤 갱신은 진행한다 — 실패는 각 호출자가 자기 결과로 받는다.
    const current = previous
      .catch(() => undefined)
      .then(() => this.runExclusive(input));
    this.chains.set(input.previewId, current);
    try {
      return await current;
    } finally {
      // 내 뒤에 다른 갱신이 붙었으면 사슬을 그대로 둔다(그 갱신이 마지막에 치운다).
      if (this.chains.get(input.previewId) === current) {
        this.chains.delete(input.previewId);
      }
    }
  }

  private async runExclusive({
    previewId,
    slackUserId,
    update,
    now = new Date(),
  }: {
    previewId: string;
    slackUserId: string;
    // 현재 payload(unknown) → 새 payload. 형식 검증은 호출자 책임 — 도메인별
    // payload schema 를 preview-gate 가 알 수 없기 때문이다. throw 하면 그대로 전파된다.
    update: (current: unknown) => unknown;
    now?: Date;
  }): Promise<PreviewAction> {
    const preview = await this.repository.findById(previewId);
    if (!preview) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.NOT_FOUND,
        message: `Preview ${previewId} 를 찾을 수 없습니다.`,
        status: DomainStatus.NOT_FOUND,
      });
    }
    if (preview.slackUserId !== slackUserId) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.WRONG_OWNER,
        message: '다른 사용자의 preview 를 수정할 수 없습니다.',
        status: DomainStatus.FORBIDDEN,
      });
    }
    if (preview.status !== PREVIEW_STATUS.PENDING) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.ALREADY_RESOLVED,
        message: `Preview 가 이미 ${preview.status} 상태입니다.`,
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }
    if (preview.expiresAt.getTime() <= now.getTime()) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.EXPIRED,
        message: 'Preview 가 만료되었습니다 (TTL 초과). 새로 요청해주세요.',
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }
    // 실행이 시작된 뒤의 수정은 반영될 수 없다. apply 는 시작 시점의 payload 로 끝까지
    // 진행하고 DB 상태는 그동안 PENDING 이라, 여기서 막지 않으면 화면에는 바뀐 내용이
    // 남고 실제로는 옛 내용이 실행돼 둘이 어긋난다.
    if (this.applyPreview.isApplying(previewId)) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.ALREADY_APPLYING,
        message: '이미 실행이 시작돼 지금은 내용을 바꿀 수 없습니다.',
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }
    const payload = update(preview.payload);
    return await this.repository.updatePayload({ id: previewId, payload });
  }
}
