// Episodic Memory 통합 round-trip 검증 — 실제 pgvector + LocalEmbedder 로
// record → 적재 → searchRelevant 의미검색까지 end-to-end 확인.
// NestFactory.createApplicationContext 로 ConfigModule(.env) + PrismaModule + EpisodicMemoryModule 만
// 부팅(HTTP/BullMQ/Slack 미기동). PrismaService.onModuleInit 이 vector extension + HNSW 인덱스도 생성.
// 실행: pnpm exec ts-node scripts/episodic-roundtrip.ts (DB 기동 + 모델 캐시 필요)
import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { EpisodicMemoryModule } from '../src/episodic-memory/episodic-memory.module';
import {
  EPISODIC_MEMORY_PORT,
  EpisodicMemoryPort,
} from '../src/episodic-memory/domain/port/episodic-memory.port';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    EpisodicMemoryModule,
  ],
})
class EpisodicRoundtripModule {}

// 충돌 회피용 높은 가짜 agent_run id (실데이터와 분리, 검증 후 정리).
const TEST_RUN_IDS = [999001, 999002, 999003];
const PAYMENT_IDS = [999001, 999002];

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    EpisodicRoundtripModule,
    { logger: ['warn', 'error'] },
  );
  const service = app.get<EpisodicMemoryPort>(EPISODIC_MEMORY_PORT);
  const prisma = app.get(PrismaService);

  // 이전 잔존 정리
  await prisma.episodicMemory.deleteMany({
    where: { agentRunId: { in: TEST_RUN_IDS } },
  });

  // 적재 (결제 관련 2 + 무관 1)
  await service.record({
    kind: 'agent_run',
    agentRunId: 999001,
    agentType: 'PM',
    content: '결제 모듈 PG 연동 리팩토링 — 카드 결제 실패 재시도 처리 개선',
    occurredAt: new Date(),
  });
  await service.record({
    kind: 'agent_run',
    agentRunId: 999002,
    agentType: 'PM',
    content: '결제 환불 정산 배치 작업 분리',
    occurredAt: new Date(),
  });
  await service.record({
    kind: 'agent_run',
    agentRunId: 999003,
    agentType: 'PM',
    content: '점심 메뉴 추천 슬랙봇 프로토타입',
    occurredAt: new Date(),
  });

  // 의미검색 — FTS('simple')로는 "결제 코드 개선"이 "결제 모듈 리팩토링"과 토큰이 겹치지 않아
  // 매칭이 약하지만, 임베딩 의미검색은 회수해야 한다.
  const hits = await service.searchRelevant({
    query: '결제 코드 개선',
    kind: 'agent_run',
    agentType: 'PM',
    limit: 3,
  });
  console.log(
    '검색 결과:',
    hits.map((hit) => ({
      runId: hit.agentRunId,
      score: Number(hit.score.toFixed(4)),
    })),
  );

  const top = hits[0];
  if (!top || !PAYMENT_IDS.includes(top.agentRunId ?? -1)) {
    throw new Error(`ROUND-TRIP FAIL: top 이 결제 관련이 아님 — top=${top?.agentRunId}`);
  }
  const lunchRank = hits.findIndex((hit) => hit.agentRunId === 999003);
  const paymentRank = hits.findIndex((hit) =>
    PAYMENT_IDS.includes(hit.agentRunId ?? -1),
  );
  if (lunchRank !== -1 && lunchRank < paymentRank) {
    throw new Error('ROUND-TRIP FAIL: 무관(점심)이 결제보다 상위로 랭크됨');
  }

  // 정리
  await prisma.episodicMemory.deleteMany({
    where: { agentRunId: { in: TEST_RUN_IDS } },
  });
  await app.close();

  console.log(
    `ROUND-TRIP OK — record → pgvector → searchRelevant 의미검색 정상 (top=${top.agentRunId}, score=${top.score.toFixed(4)})`,
  );
}

main().catch(async (error) => {
  console.error('ROUND-TRIP FAIL:', error);
  process.exit(1);
});
