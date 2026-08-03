import { CeoErrorCode } from '../../agent/ceo/domain/ceo-error-code.enum';
import { CtoErrorCode } from '../../agent/cto/domain/cto-error-code.enum';
import { PoEvalErrorCode } from '../../agent/po-eval/domain/po-eval-error-code.enum';
import { PoShadowErrorCode } from '../../agent/po-shadow/domain/po-shadow-error-code.enum';
import { AgentType } from '../../model-router/domain/model-router.type';
import { resolveChain } from './precondition-chain.map';

describe('precondition-chain.map', () => {
  it('CTO PM 부재는 PM 선행으로 해소한다', () => {
    expect(resolveChain(CtoErrorCode.NO_RECENT_PM_RUN)).toEqual({
      kind: 'PREREQ',
      failedWorkerLabel: 'CTO',
      prereqWorker: AgentType.PM,
    });
    expect(resolveChain(CtoErrorCode.STALE_PM_RUN)).toMatchObject({
      kind: 'PREREQ',
      prereqWorker: AgentType.PM,
    });
  });

  it('PO_SHADOW plan 부재는 PM 선행으로 해소한다', () => {
    expect(resolveChain(PoShadowErrorCode.NO_RECENT_PLAN)).toMatchObject({
      kind: 'PREREQ',
      prereqWorker: AgentType.PM,
    });
  });

  it('CEO PO_EVAL 부재는 PO_EVAL 선행으로 해소한다', () => {
    expect(resolveChain(CeoErrorCode.NO_PO_EVAL_RUN)).toMatchObject({
      kind: 'PREREQ',
      prereqWorker: AgentType.PO_EVAL,
    });
  });

  it('PO_EVAL sub-agent 부재는 IMPACT_REPORTER --recent 로 해소한다', () => {
    expect(resolveChain(PoEvalErrorCode.NO_SUB_AGENT_RUNS)).toMatchObject({
      kind: 'PREREQ',
      prereqWorker: AgentType.IMPACT_REPORTER,
      needsRecentArg: true,
    });
  });

  it('CTO assignableTaskIds 부재는 자동해소 불가로 분류한다', () => {
    expect(resolveChain(CtoErrorCode.NO_ASSIGNABLE_TASKS)).toEqual({
      kind: 'UNRESOLVABLE',
    });
  });

  it('CTO PM output 형식 오류는 자동해소 불가로 분류한다', () => {
    expect(resolveChain(CtoErrorCode.INVALID_PLAN_OUTPUT)).toEqual({
      kind: 'UNRESOLVABLE',
    });
  });

  it('매핑에 없는 errorCode 는 undefined', () => {
    expect(resolveChain('PARSE_FAILED')).toBeUndefined();
    expect(
      resolveChain('IMPACT_REPORTER_RECENT_MODE_ENV_MISSING'),
    ).toBeUndefined();
  });
});
