import { Module } from '@nestjs/common';

import { SAJU_FORTUNE_DAY_REPOSITORY_PORT } from './domain/port/saju-fortune-day.repository.port';
import { SajuCardCollageRenderer } from './infrastructure/saju-card-collage.renderer';
import { SajuFortuneDayPrismaRepository } from './infrastructure/saju-fortune-day.prisma.repository';

// 사주 운세 하루 기록 — SajuFortuneCronModule(아침 기록·저녁 확인)과 SlackModule(미션 버튼)이 함께 import 한다.
// SajuFortuneCronModule 은 SlackModule 을 import 하므로 저장소를 그쪽에 두면 순환이 생겨 따로 뺐다.
@Module({
  providers: [
    {
      provide: SAJU_FORTUNE_DAY_REPOSITORY_PORT,
      useClass: SajuFortuneDayPrismaRepository,
    },
    SajuCardCollageRenderer,
  ],
  exports: [SAJU_FORTUNE_DAY_REPOSITORY_PORT, SajuCardCollageRenderer],
})
export class SajuFortuneDayModule {}
