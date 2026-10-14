import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  MENTION_FINAL_REPLY_STATUS,
  MENTION_RECEIPT_STATUS,
  MentionFinalReplyStatus,
  MentionReceiptRef,
  MentionReceiptRepositoryPort,
  MentionReceiptStatus,
  RecordMentionOutcomeInput,
  RecordMentionReceivedInput,
} from '../domain/port/mention-receipt.repository.port';

const ERROR_MESSAGE_MAX_LENGTH = 200;

// 뒤 상태일수록 우선한다. 같은 이벤트가 재전송돼 두 번 처리되면 나중 시도의 실패가 먼저 시도의
// 게시 성공을 덮어써 답이 나간 멘션이 미응답으로 세질 수 있어, 우선순위가 낮은 행만 갱신한다.
const OUTCOME_PRECEDENCE: MentionReceiptStatus[] = [
  MENTION_RECEIPT_STATUS.RECEIVED,
  MENTION_RECEIPT_STATUS.REPLY_FAILED,
  MENTION_RECEIPT_STATUS.ERROR_REPLIED,
  MENTION_RECEIPT_STATUS.REPLIED,
];

// 결과 답장도 같은 이유로 뒤 상태만 덮는다 — 재전송된 중복 실행의 대기·실패가 먼저 끝난 게시를 지우지 않게.
// 아직 아무 기록이 없는 행(null)은 어느 상태로든 갱신한다.
const FINAL_REPLY_PRECEDENCE: MentionFinalReplyStatus[] = [
  MENTION_FINAL_REPLY_STATUS.PENDING,
  MENTION_FINAL_REPLY_STATUS.FAILED,
  MENTION_FINAL_REPLY_STATUS.POSTED,
];

@Injectable()
export class MentionReceiptPrismaRepository implements MentionReceiptRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async recordReceived({
    source,
    channelId,
    messageTs,
  }: RecordMentionReceivedInput): Promise<void> {
    await this.prisma.mentionReceipt.createMany({
      data: [
        {
          source,
          channelId,
          messageTs,
          status: MENTION_RECEIPT_STATUS.RECEIVED,
        },
      ],
      skipDuplicates: true,
    });
  }

  async recordOutcome({
    channelId,
    messageTs,
    status,
    errorMessage,
  }: RecordMentionOutcomeInput): Promise<void> {
    await this.prisma.mentionReceipt.updateMany({
      where: {
        channelId,
        messageTs,
        status: {
          in: OUTCOME_PRECEDENCE.slice(0, OUTCOME_PRECEDENCE.indexOf(status)),
        },
      },
      data: {
        status,
        errorMessage: errorMessage?.slice(0, ERROR_MESSAGE_MAX_LENGTH) ?? null,
        repliedAt:
          status === MENTION_RECEIPT_STATUS.REPLY_FAILED ? null : new Date(),
      },
    });
  }

  async recordFinalReply({
    channelId,
    messageTs,
    status,
  }: MentionReceiptRef & { status: MentionFinalReplyStatus }): Promise<void> {
    await this.prisma.mentionReceipt.updateMany({
      where: {
        channelId,
        messageTs,
        OR: [
          { finalReplyStatus: null },
          {
            finalReplyStatus: {
              in: FINAL_REPLY_PRECEDENCE.slice(
                0,
                FINAL_REPLY_PRECEDENCE.indexOf(status),
              ),
            },
          },
        ],
      },
      data: { finalReplyStatus: status },
    });
  }
}
