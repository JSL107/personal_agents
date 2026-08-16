import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { HumanizeModule } from '../../humanize/humanize.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { EvaluateStudyTopicUsecase } from './application/evaluate-study-topic.usecase';
import { GenerateAssignmentUsecase } from './application/generate-assignment.usecase';
import { OpenAssignmentApprovalUsecase } from './application/open-assignment-approval.usecase';
import { CtoDispatcher } from './infrastructure/cto.dispatcher';

// V3 비전 P2 Assign — PM 의 직전 DailyPlan.assignableTaskIds 를 BE worker 3종에 분배.
// dispatcher 는 RouterModule 의 useFactory inject 에 등록 — agent module 자체는 dispatcher class
// 만 노출하면 됨 (NestJS multi-provider 의 single module scope 회피 패턴, commit cbef813 참고).
@Module({
  imports: [ModelRouterModule, AgentRunModule, HumanizeModule],
  providers: [
    GenerateAssignmentUsecase,
    // 실행 승인 카드(PreviewGate CTO_BE_CHAIN) 개설. PreviewGateModule 은 forRoot 에서
    // global 로 등록돼 있어 별도 imports 없이 CreatePreview/Cancel/FindAllOpen 주입이 된다.
    OpenAssignmentApprovalUsecase,
    CtoDispatcher,
    EvaluateStudyTopicUsecase,
  ],
  exports: [
    GenerateAssignmentUsecase,
    OpenAssignmentApprovalUsecase,
    CtoDispatcher,
    EvaluateStudyTopicUsecase,
  ],
})
export class CtoModule {}
