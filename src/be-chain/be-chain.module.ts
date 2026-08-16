import { Module } from '@nestjs/common';

import { BeAgentModule } from '../agent/be/be.module';
import { BeSchemaModule } from '../agent/be-schema/be-schema.module';
import { BeTestModule } from '../agent/be-test/be-test.module';
import { AgentRunModule } from '../agent-run/agent-run.module';
import { RunBeChainUsecase } from './application/run-be-chain.usecase';
import { CtoBeChainApplier } from './infrastructure/cto-be-chain.applier';

// CTO 분배 → BE worker 실행 단계만 담는 모듈.
//
// CtoModule 이 아니라 별도 모듈인 이유는 의존 방향 때문이다. CtoDispatcher 는 분배 직후
// 실행 승인 카드를 열어야 해서 PreviewGate(CreatePreviewUsecase)에 의존하고, 실행 applier 는
// 반대로 PreviewGate 가 forRoot 로 끌어와야 한다. 둘을 한 모듈에 두면 CtoModule ↔
// PreviewGateModule 순환이 된다. 실행기를 여기로 떼어내면 PreviewGate → BeChain → BE worker
// 한 방향으로만 흐른다.
@Module({
  imports: [BeAgentModule, BeSchemaModule, BeTestModule, AgentRunModule],
  providers: [RunBeChainUsecase, CtoBeChainApplier],
  exports: [RunBeChainUsecase, CtoBeChainApplier],
})
export class BeChainModule {}
