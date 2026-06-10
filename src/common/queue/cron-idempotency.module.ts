import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import { CronIdempotencyService } from './cron-idempotency.service';

// cron 중복 발송 차단 모듈 — @Global() 로 등록하여 각 cron consumer 모듈에서
// 별도 import 없이 CronIdempotencyService 를 주입받을 수 있게 한다.
//
// RouterModule 의 ConversationMemoryService useFactory 패턴을 그대로 답습:
//   - REDIS_HOST/REDIS_PORT 가 설정되어 있으면 별도 IORedis 커넥션 생성.
//   - 미설정 시 redis = undefined → service 가 in-memory fallback 으로 동작.
//   - BullMQ 의 Redis 커넥션과 분리 (maxRetries=null 설정 등 오염 방지).
@Global()
@Module({
  providers: [
    {
      provide: CronIdempotencyService,
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('REDIS_HOST');
        const port = configService.get<number>('REDIS_PORT');
        if (!host || !port) {
          return new CronIdempotencyService();
        }
        const redis = new Redis({
          host,
          port,
          lazyConnect: false,
          maxRetriesPerRequest: 3,
        });
        return new CronIdempotencyService(redis);
      },
      inject: [ConfigService],
    },
  ],
  exports: [CronIdempotencyService],
})
export class CronIdempotencyModule {}
