import { Injectable } from '@nestjs/common';
import { App } from '@slack/bolt';

import { SubconsciousProposalService } from '../../subconscious/application/subconscious-proposal.service';
import { SUBCONSCIOUS_PROPOSAL_ACTION_IDS } from '../format/subconscious-proposal-message.builder';
import {
  extractActionUserId,
  extractActionValue,
} from '../bolt/action-body.parser';
import { SlackHandler } from '../domain/port/slack-handler.port';
import { toUserFacingErrorMessage } from './slack-handler.helper';

// Subconscious Proposal 버튼 액션 핸들러.
// ✅실행(subconscious_proposal_apply) / ❌무시(subconscious_proposal_dismiss) 버튼 처리.
// body.actions[0].value 에 proposalId(숫자 string), body.user.id 가 클릭한 사용자.
// SubconsciousProposalService 가 owner 매칭 + PENDING + TTL 검증 + dispatch 위임.
@Injectable()
export class SubconsciousProposalActionHandler implements SlackHandler {
  constructor(
    private readonly subconsciousProposalService: SubconsciousProposalService,
  ) {}

  register(app: App): void {
    app.action(
      SUBCONSCIOUS_PROPOSAL_ACTION_IDS.APPLY,
      async ({ ack, body, respond }) => {
        await ack();
        const proposalIdStr = extractActionValue(body);
        const slackUserId = extractActionUserId(body);
        if (!proposalIdStr || !slackUserId) {
          return;
        }
        const proposalId = parseInt(proposalIdStr, 10);
        if (isNaN(proposalId)) {
          return;
        }
        try {
          const resultText = await this.subconsciousProposalService.apply(
            proposalId,
            slackUserId,
          );
          await respond({
            response_type: 'ephemeral',
            replace_original: true,
            text: resultText,
          });
        } catch (error: unknown) {
          await respond({
            response_type: 'ephemeral',
            replace_original: true,
            text: `제안 실행 실패: ${toUserFacingErrorMessage(error)}`,
          });
        }
      },
    );

    app.action(
      SUBCONSCIOUS_PROPOSAL_ACTION_IDS.DISMISS,
      async ({ ack, body, respond }) => {
        await ack();
        const proposalIdStr = extractActionValue(body);
        const slackUserId = extractActionUserId(body);
        if (!proposalIdStr || !slackUserId) {
          return;
        }
        const proposalId = parseInt(proposalIdStr, 10);
        if (isNaN(proposalId)) {
          return;
        }
        try {
          await this.subconsciousProposalService.dismiss(
            proposalId,
            slackUserId,
          );
          await respond({
            response_type: 'ephemeral',
            replace_original: true,
            text: '❌ 제안 무시됨 — 부작용 없이 마감되었습니다.',
          });
        } catch (error: unknown) {
          await respond({
            response_type: 'ephemeral',
            replace_original: true,
            text: `제안 무시 실패: ${toUserFacingErrorMessage(error)}`,
          });
        }
      },
    );
  }
}
