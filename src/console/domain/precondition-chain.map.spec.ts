import { CeoErrorCode } from '../../agent/ceo/domain/ceo-error-code.enum';
import { CtoErrorCode } from '../../agent/cto/domain/cto-error-code.enum';
import { PoEvalErrorCode } from '../../agent/po-eval/domain/po-eval-error-code.enum';
import { PoShadowErrorCode } from '../../agent/po-shadow/domain/po-shadow-error-code.enum';
import { AgentType } from '../../model-router/domain/model-router.type';
import { resolveChain } from './precondition-chain.map';

describe('precondition-chain.map', () => {
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

  // 두 케이스가 같은 단정을 하고 있었다. 이름은 폐지된 배정 워커(/assign, 2026-09-07 #479)의
  // 에러 코드를 가리키는데 본문은 그 코드가 사라진 뒤 학습 판정 코드로 옮겨졌던 것이라, 하나로 합친다.
  it('학습 주제 판정 실패는 자동해소 불가로 분류한다', () => {
    expect(resolveChain(CtoErrorCode.INVALID_STUDY_VERDICT)).toEqual({
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
