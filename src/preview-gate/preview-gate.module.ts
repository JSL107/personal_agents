import { DynamicModule, Module, ModuleMetadata, Type } from '@nestjs/common';

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
  static forRoot({
    appliers,
    imports = [],
  }: {
    appliers: Type<PreviewApplier>[];
    // applier 가 의존하는 도메인 모듈들 (GithubModule / NotionModule 등) — DynamicModule 안에서 import.
    imports?: ModuleMetadata['imports'];
  }): DynamicModule {
    return {
      module: PreviewGateModule,
      // global: true 로 둬 SlackModule / PmAgentModule 등 사용 모듈이 별도 import 안 해도
      // ApplyPreviewUsecase / CancelPreviewUsecase / CreatePreviewUsecase 주입 가능.
      global: true,
      imports,
      providers: [
        ...appliers,
        {
          provide: PREVIEW_APPLIERS,
          useFactory: (...resolved: PreviewApplier[]) => resolved,
          inject: appliers,
        },
      ],
      exports: [...appliers],
    };
  }
}
