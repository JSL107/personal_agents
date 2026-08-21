import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { PrismaModule } from '../prisma/prisma.module';
import { ExpandStudyBriefUsecase } from './application/expand-study-brief.usecase';
import { StudyDeepdiveModule } from './study-deepdive.module';

// 이 모듈은 autopilot 컨텍스트와 실증 CLI 양쪽에서 쓰인다. autopilot 은 다른 모듈이 이미
// 올려 둔 provider 를 얻어 가므로, 이 모듈이 자기 의존성을 빠뜨려도 그쪽에서는 멀쩡히 돈다.
// 실제로 CronIdempotencyService 가 빠진 채였고 cron 은 매일 정상, CLI 만 부팅에서 죽었다.
// 실증 입구가 있는데 실행하면 죽는 상태라 아무도 알아채지 못했다.
//
// 그래서 usecase 를 얻어오는 것이 아니라 **이 모듈만으로 부팅되는지**를 본다.
describe('StudyDeepdiveModule', () => {
  it('다른 모듈 없이 혼자 부팅해 확장 usecase 를 내준다', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        StudyDeepdiveModule,
      ],
    }).compile();

    expect(moduleRef.get(ExpandStudyBriefUsecase)).toBeInstanceOf(
      ExpandStudyBriefUsecase,
    );
    await moduleRef.close();
  });
});
