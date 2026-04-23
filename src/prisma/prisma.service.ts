import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Prisma 연결은 lazy connect 를 유지한다.
// onModuleInit 에서 $connect() 를 호출하지 않으므로, Prisma 를 사용하지 않는 도메인만 떠 있는 환경(예: 크롤러 단독 실행)에서는
// PostgreSQL 이 없어도 앱이 정상 부팅된다. 첫 쿼리 시점에 자동으로 연결된다.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
