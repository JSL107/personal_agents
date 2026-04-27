import { DynamicModule, Module, Type } from '@nestjs/common';

import { ApplyPreviewUsecase } from './application/apply-preview.usecase';
import { CancelPreviewUsecase } from './application/cancel-preview.usecase';
import { CreatePreviewUsecase } from './application/create-preview.usecase';
import { PREVIEW_ACTION_REPOSITORY_PORT } from './domain/port/preview-action.repository.port';
import {
  PREVIEW_APPLIERS,
  PreviewApplier,
} from './domain/port/preview-applier.port';
import { PreviewActionPrismaRepository } from './infrastructure/preview-action.prisma.repository';

// PO-2 Preview Gate 도메인 모듈.
// `forRoot` 로 PreviewApplier 구현체 클래스 목록을 받아 PREVIEW_APPLIERS 멀티 프로바이더로 등록.
// PM-2 등 applier 를 추가하는 모듈은 자기 클래스를 PreviewGateModule.forRoot([PmWriteBackApplier, ...])
// 형태로 AppModule 에서 명시 — module 경계 침범 없이 strategy 등록.
@Module({
  providers: [
    CreatePreviewUsecase,
    ApplyPreviewUsecase,
    CancelPreviewUsecase,
    {
      provide: PREVIEW_ACTION_REPOSITORY_PORT,
      useClass: PreviewActionPrismaRepository,
    },
    {
      // applier 가 등록 안 된 상태에서도 ApplyPreviewUsecase 가 DI 에러 없이 부팅되도록 빈 배열 default.
      // forRoot 가 호출되면 그쪽 useFactory 가 이 useValue 를 덮어쓴다.
      provide: PREVIEW_APPLIERS,
      useValue: [] as PreviewApplier[],
    },
  ],
  exports: [CreatePreviewUsecase, ApplyPreviewUsecase, CancelPreviewUsecase],
})
export class PreviewGateModule {
  static forRoot(applierClasses: Type<PreviewApplier>[]): DynamicModule {
    return {
      module: PreviewGateModule,
      providers: [
        ...applierClasses,
        {
          provide: PREVIEW_APPLIERS,
          useFactory: (...appliers: PreviewApplier[]) => appliers,
          inject: applierClasses,
        },
      ],
      exports: [...applierClasses],
    };
  }
}
