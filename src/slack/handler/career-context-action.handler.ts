import { Injectable, Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { withImpactContext } from '../../agent/career-mate/domain/evening-career-payload';
import { UpdatePreviewPayloadUsecase } from '../../preview-gate/application/update-preview-payload.usecase';
import {
  extractActionBlockId,
  extractActionMessageRef,
  extractActionUserId,
  extractInputValue,
} from '../bolt/action-body.parser';
import { SlackHandler } from '../domain/port/slack-handler.port';
import {
  CAREER_CONTEXT_ACTION_IDS,
  normalizeImpactContext,
  parseCareerContextBlockId,
} from '../format/career-context-input.builder';
import { buildPreviewBlocks } from '../format/preview-message.builder';
import { toUserFacingErrorMessage } from './slack-handler.helper';

// 저녁 경력 반영 카드의 묶음별 "작업 맥락" 입력 처리.
//
// 승인/취소 버튼은 PreviewGate 공용 action 이 그대로 받는다. 여기서 다루는 건 "승인 전에
// 승인 대상에 한 줄을 덧붙이는" 조작뿐이라, preview 를 새로 만들지 않고 같은 카드의 payload
// 만 갱신한 뒤 카드를 다시 그린다 — CTO 분배 카드의 배정 드롭다운과 같은 구조다.
//
// 소유자 일치·PENDING·미만료·실행중 여부 검증은 UpdatePreviewPayloadUsecase 가 한다.
// 특히 실행이 시작된 뒤의 입력은 거기서 막힌다 — 반영은 시작 시점의 payload 로 끝까지
// 진행하므로, 막지 않으면 화면에만 남고 이력서에는 안 실린 맥락이 생긴다.
@Injectable()
export class CareerContextActionHandler implements SlackHandler {
  private readonly logger = new Logger(CareerContextActionHandler.name);

  constructor(
    private readonly updatePreviewPayload: UpdatePreviewPayloadUsecase,
  ) {}

  register(app: App): void {
    app.action(
      CAREER_CONTEXT_ACTION_IDS.SET,
      async ({ ack, body, respond, client }) => {
        await ack();
        const target = parseCareerContextBlockId(extractActionBlockId(body));
        const slackUserId = extractActionUserId(body);
        const typed = extractInputValue(body);
        if (!target || !slackUserId || typed === null) {
          this.logger.warn(
            '경력 맥락 입력 이벤트 해석 실패 — block_id / 사용자 / 입력값 중 누락.',
          );
          return;
        }
        const impactContext = normalizeImpactContext(typed);

        try {
          const updated = await this.updatePreviewPayload.execute({
            previewId: target.previewId,
            slackUserId,
            update: (current) =>
              withImpactContext({
                payload: current,
                index: target.index,
                impactContext,
              }),
          });
          this.logger.log(
            `경력 맥락 ${impactContext.length > 0 ? '저장' : '삭제'} — previewId=${target.previewId} 묶음=${target.index} (${impactContext.length}자)`,
          );
          // 카드를 다시 그린다 — 메시지 안의 input 값은 서버에 남지 않아서, 여기서
          // 갱신하지 않으면 슬랙을 다시 열었을 때 적어둔 맥락이 사라진 것처럼 보인다.
          // 좌표를 못 읽으면 그리기만 건너뛴다: 저장은 이미 끝났고, 승인하면 반영된다.
          const messageRef = extractActionMessageRef(body);
          if (messageRef) {
            await client.chat.update({
              channel: messageRef.channel,
              ts: messageRef.ts,
              text: updated.previewText,
              blocks: buildPreviewBlocks({
                previewText: updated.previewText,
                previewId: target.previewId,
                kind: updated.kind,
                payload: updated.payload,
              }) as never,
            });
          } else {
            this.logger.warn(
              `경력 맥락 카드 좌표를 읽지 못해 다시 그리지 못했습니다 — previewId=${target.previewId} (저장은 완료).`,
            );
          }
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `경력 맥락 저장 실패 — previewId=${target.previewId}: ${message}`,
          );
          // 카드는 그대로 둔다 — 여기서 덮으면 사용자가 방금 친 문장을 화면에서 잃는다.
          await respond({
            response_type: 'ephemeral',
            replace_original: false,
            text: `맥락 저장 실패: ${toUserFacingErrorMessage(error)}`,
          });
        }
      },
    );
  }
}
