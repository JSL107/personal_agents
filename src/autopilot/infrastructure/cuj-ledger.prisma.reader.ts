import { Injectable } from '@nestjs/common';

import { RoutedVia } from '../../agent-run/domain/agent-run.type';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CujDeliveryRow,
  CujLedgerReaderPort,
  CujMentionReceiptRow,
  CujOrderRow,
  CujPreviewRow,
  CujRunRow,
} from '../domain/port/cuj-ledger.reader.port';

const RUN_SELECT = {
  status: true,
  agentType: true,
  durationMs: true,
  startedAt: true,
  output: true,
} as const;

// 라우터는 PM·업무 회고 같은 워커를 기존 슬래시 트리거(SLACK_COMMAND_*)로 부르고, 라우팅 근거는
// inputSnapshot.routedVia 에 남긴다. 트리거 접두사만 보면 그 멘션들이 빠진다.
// Record 로 적어 RoutedVia 에 값이 늘면 컴파일이 여기서 멈추게 한다.
const ROUTED_VIA: Record<RoutedVia, true> = {
  classifier: true,
  hint: true,
  nickname: true,
};

const isRecordValue = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

@Injectable()
export class CujLedgerPrismaReader implements CujLedgerReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async findLatestCujCheckDeliveryBefore(before: Date): Promise<Date | null> {
    const delivery = await this.prisma.slackDelivery.findFirst({
      where: {
        itemKinds: { has: 'cuj-check' },
        createdAt: { lt: before },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return delivery?.createdAt ?? null;
  }

  async readPrReviews(since: Date, until: Date): Promise<CujRunRow[]> {
    return await this.prisma.agentRun.findMany({
      where: {
        triggerType: 'PR_REVIEW_SWEEP',
        agentType: 'CODE_REVIEWER',
        startedAt: { gte: since, lt: until },
      },
      select: RUN_SELECT,
    });
  }

  async readDeliveries(since: Date, until: Date): Promise<CujDeliveryRow[]> {
    return await this.prisma.slackDelivery.findMany({
      where: { createdAt: { gte: since, lt: until } },
      select: {
        status: true,
        itemKinds: true,
        createdAt: true,
        suppressReason: true,
        errorMessage: true,
      },
    });
  }

  async readPaperRecommendations(
    since: Date,
    until: Date,
  ): Promise<CujRunRow[]> {
    const rows = await this.prisma.agentRun.findMany({
      where: {
        agentType: 'PAPER_RECOMMEND',
        startedAt: { gte: since, lt: until },
      },
      select: { ...RUN_SELECT, inputSnapshot: true },
    });
    // `/retry-run` 은 과거 회차를 원래 decidedAt 그대로 재실행한다(replay-failed-run.usecase.ts).
    // 시작 시각만 보면 그 재실행이 그날 정규 회차로 섞여, 정규 회차의 실패·낡은 시세를 가리거나
    // 과거 날짜의 시세로 엉뚱한 경보를 낸다. 판단 기준일이 점검 범위 안인 회차만 남긴다.
    return rows
      .filter(({ inputSnapshot }) => {
        const decidedAt = isRecordValue(inputSnapshot)
          ? inputSnapshot.decidedAt
          : undefined;
        if (typeof decidedAt !== 'string') {
          return true;
        }
        const time = new Date(decidedAt).getTime();
        return time >= since.getTime() && time < until.getTime();
      })
      .map(({ status, agentType, durationMs, startedAt, output }) => ({
        status,
        agentType,
        durationMs,
        startedAt,
        output,
      }));
  }

  async readPendingOrders(before: Date): Promise<CujOrderRow[]> {
    return await this.prisma.paperOrder.findMany({
      where: { status: 'PENDING', targetTradeDate: { lt: before } },
      select: { targetTradeDate: true },
    });
  }

  async readMentions(since: Date, until: Date): Promise<CujRunRow[]> {
    return await this.prisma.agentRun.findMany({
      where: {
        startedAt: { gte: since, lt: until },
        OR: [
          { triggerType: { startsWith: 'SLACK_MENTION_' } },
          ...Object.keys(ROUTED_VIA).map((routedVia) => ({
            inputSnapshot: { path: ['routedVia'], equals: routedVia },
          })),
        ],
      },
      select: RUN_SELECT,
    });
  }

  async readMentionReceipts(
    since: Date,
    until: Date,
  ): Promise<CujMentionReceiptRow[]> {
    return await this.prisma.mentionReceipt.findMany({
      where: { receivedAt: { gte: since, lt: until } },
      select: { status: true, finalReplyStatus: true },
    });
  }

  async countUnpostedFindings(since: Date, until: Date): Promise<number> {
    // 의도된 미게시(SUPPRESSED)는 빼고, 게시 실패로 OPEN 에 남은 카드만 센다.
    return await this.prisma.prReviewFinding.count({
      where: {
        postMode: 'NOT_POSTED',
        status: 'OPEN',
        createdAt: { gte: since, lt: until },
      },
    });
  }

  async readFailedPreviews(since: Date, until: Date): Promise<CujPreviewRow[]> {
    return await this.prisma.previewAction.findMany({
      where: {
        lastFailedAt: { gte: since, lt: until },
        status: { not: 'APPLIED' },
      },
      select: { kind: true },
    });
  }
}
