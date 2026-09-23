import { DynamicModule, Module, ModuleMetadata, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebClient } from '@slack/web-api';

import { ApplyPreviewUsecase } from './application/apply-preview.usecase';
import { CancelPreviewUsecase } from './application/cancel-preview.usecase';
import { CountPreviewsByPayloadUsecase } from './application/count-previews-by-payload.usecase';
import { CreatePreviewUsecase } from './application/create-preview.usecase';
import { ExpirePreviewsUsecase } from './application/expire-previews.usecase';
import { FindAllOpenPreviewsUsecase } from './application/find-all-open-previews.usecase';
import { FindLatestPendingPreviewUsecase } from './application/find-latest-pending-preview.usecase';
import { FindPreviewDayOutcomesUsecase } from './application/find-preview-day-outcomes.usecase';
import { FindRecentAppliedPreviewsUsecase } from './application/find-recent-applied-previews.usecase';
import { ResumeInterruptedAppliesUsecase } from './application/resume-interrupted-applies.usecase';
import { UpdatePreviewPayloadUsecase } from './application/update-preview-payload.usecase';
import { PREVIEW_ACTION_REPOSITORY_PORT } from './domain/port/preview-action.repository.port';
import {
  PREVIEW_APPLIERS,
  PreviewApplier,
} from './domain/port/preview-applier.port';
import {
  PREVIEW_CANCELLERS,
  PreviewCanceller,
} from './domain/port/preview-canceller.port';
import { PREVIEW_CARD_PORT } from './domain/port/preview-card.port';
import {
  RESULT_VERIFIERS,
  ResultVerifier,
} from './domain/port/result-verifier.port';
import { PreviewActionPrismaRepository } from './infrastructure/preview-action.prisma.repository';
import {
  PREVIEW_CARD_SLACK_CLIENT,
  SlackPreviewCardUpdater,
} from './infrastructure/slack-preview-card.updater';

// PO-2 Preview Gate 도메인 모듈.
// `forRoot` 로 PreviewApplier 구현체 클래스 목록을 받아 PREVIEW_APPLIERS 멀티 프로바이더로 등록.
// PM-2 등 applier 를 추가하는 모듈은 자기 클래스를 PreviewGateModule.forRoot([PmWriteBackApplier, ...])
// 형태로 AppModule 에서 명시 — module 경계 침범 없이 strategy 등록.
@Module({
  providers: [
    CreatePreviewUsecase,
    ApplyPreviewUsecase,
    CancelPreviewUsecase,
    ExpirePreviewsUsecase,
    FindLatestPendingPreviewUsecase,
    FindAllOpenPreviewsUsecase,
    FindRecentAppliedPreviewsUsecase,
    FindPreviewDayOutcomesUsecase,
    CountPreviewsByPayloadUsecase,
    UpdatePreviewPayloadUsecase,
    {
      provide: PREVIEW_ACTION_REPOSITORY_PORT,
      useClass: PreviewActionPrismaRepository,
    },
    // 카드 갱신 어댑터 — 자체 WebClient. SLACK_BOT_TOKEN 미설정 시 client=null → updater no-op.
    {
      provide: PREVIEW_CARD_SLACK_CLIENT,
      useFactory: (configService: ConfigService): WebClient | null => {
        const token = configService.get<string>('SLACK_BOT_TOKEN');
        if (!token) {
          return null;
        }
        return new WebClient(token);
      },
      inject: [ConfigService],
    },
    {
      provide: PREVIEW_CARD_PORT,
      useClass: SlackPreviewCardUpdater,
    },
    {
      // applier 가 등록 안 된 상태에서도 ApplyPreviewUsecase 가 DI 에러 없이 부팅되도록 빈 배열 default.
      // forRoot 가 호출되면 그쪽 useFactory 가 이 useValue 를 덮어쓴다.
      provide: PREVIEW_APPLIERS,
      useValue: [] as PreviewApplier[],
    },
    {
      // ResultVerifier 도 동일 — 미등록 시 ApplyPreviewUsecase 가 빈 배열로 부팅 (검증 skip).
      provide: RESULT_VERIFIERS,
      useValue: [] as ResultVerifier[],
    },
    {
      // PreviewCanceller 도 동일 — 미등록 시 CancelPreviewUsecase 가 빈 배열로 부팅 (cancel 후처리 skip).
      provide: PREVIEW_CANCELLERS,
      useValue: [] as PreviewCanceller[],
    },
  ],
  exports: [
    PREVIEW_ACTION_REPOSITORY_PORT,
    CreatePreviewUsecase,
    ApplyPreviewUsecase,
    CancelPreviewUsecase,
    ExpirePreviewsUsecase,
    FindLatestPendingPreviewUsecase,
    FindAllOpenPreviewsUsecase,
    FindRecentAppliedPreviewsUsecase,
    FindPreviewDayOutcomesUsecase,
    CountPreviewsByPayloadUsecase,
    UpdatePreviewPayloadUsecase,
  ],
})
export class PreviewGateModule {
  static forRoot({
    appliers,
    verifiers = [],
    cancellers = [],
    imports = [],
  }: {
    appliers: Type<PreviewApplier>[];
    // 실행 후 결과 검증 strategy 들 (GithubPrVerifier 등). RESULT_VERIFIERS 로 중앙 등록.
    verifiers?: Type<ResultVerifier>[];
    // ❌ cancel 후처리 strategy 들 (PreferenceProfileCanceller 등). PREVIEW_CANCELLERS 로 중앙 등록.
    cancellers?: Type<PreviewCanceller>[];
    // applier/verifier/canceller 가 의존하는 도메인 모듈들 (GithubModule / NotionModule 등) — DynamicModule 안에서 import.
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
        ...verifiers,
        ...cancellers,
        // 부팅 훅 — 재시작으로 중단된 반영을 이어 돌리거나 실패로 마감하고 알린다.
        //
        // **`forRoot` 안에만 둔다.** 이 모듈은 bare 로도 import 된다(`autopilot.module.ts`,
        // `delay-report.module.ts`). NestJS 에서 static import 와 `forRoot` 는 서로 다른 모듈
        // 인스턴스이므로, 위쪽 `@Module` providers 에 두면 **applier 목록이 빈 인스턴스에서도
        // 훅이 돈다.** 그쪽은 모든 중단 카드를 "반영할 수단이 없습니다" 로 마감해 버려 재개가
        // 아예 성립하지 않는다.
        ResumeInterruptedAppliesUsecase,
        {
          provide: PREVIEW_APPLIERS,
          useFactory: (...resolved: PreviewApplier[]) => resolved,
          inject: appliers,
        },
        {
          provide: RESULT_VERIFIERS,
          useFactory: (...resolved: ResultVerifier[]) => resolved,
          inject: verifiers,
        },
        {
          provide: PREVIEW_CANCELLERS,
          useFactory: (...resolved: PreviewCanceller[]) => resolved,
          inject: cancellers,
        },
      ],
      exports: [...appliers, ...verifiers, ...cancellers],
    };
  }
}
