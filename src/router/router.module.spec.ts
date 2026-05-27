import { Test } from '@nestjs/testing';

import { AgentType } from '../model-router/domain/model-router.type';
import {
  AGENT_DISPATCHER_PORT,
  AgentDispatcher,
} from './domain/port/agent-dispatcher.port';

// 본 spec 의 목적: 본 turn (commit cbef813) 의 DI 회귀가 unit 단계에서 잡히지 않은 이유 —
// 모든 spec 이 mock 만 사용 (실제 NestJS DI 미경유) — 를 부분 보완.
// RouterModule 의 providers 안 useFactory + inject 패턴이 NestJS DI 에서 array 로 resolve 되는지를
// reference 로 검증. RouterModule 자체 import 는 외부 의존성 (ConfigService/Prisma/Bull 등) 의
// override 작업이 매우 커서 본 spec 범위 밖 — 별도 spec 의 후속 작업.
//
// 회귀 시나리오 — 이 spec 이 fail 하면 다음 중 하나가 깨졌다는 신호:
//   1. NestJS @nestjs/common Provider type 의 useFactory + inject array 의미가 변경됨
//   2. AGENT_DISPATCHER_PORT 토큰 (Symbol) 이 NestJS 에서 다르게 처리됨
//   3. (역사) module 경계를 넘는 multi-provider 패턴으로 회귀
describe('AGENT_DISPATCHER_PORT — useFactory + inject 패턴 안전망', () => {
  it('NestJS 가 inject 배열의 모든 토큰을 resolve 해 useFactory 에 spread → array 반환', async () => {
    const dispatcherTokens = ['DISP_PM', 'DISP_BE', 'DISP_WORK'];
    const mockDispatchers: AgentDispatcher[] = dispatcherTokens.map((_, i) => ({
      agentType: `MOCK_${i}` as unknown as AgentType,
      dispatch: jest.fn(),
    }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        ...dispatcherTokens.map((token, i) => ({
          provide: token,
          useValue: mockDispatchers[i],
        })),
        {
          provide: AGENT_DISPATCHER_PORT,
          useFactory: (...resolved: AgentDispatcher[]) => resolved,
          inject: dispatcherTokens,
        },
      ],
    }).compile();

    const dispatchers = moduleRef.get<AgentDispatcher[]>(AGENT_DISPATCHER_PORT);

    expect(Array.isArray(dispatchers)).toBe(true);
    expect(dispatchers).toHaveLength(dispatcherTokens.length);
    expect(dispatchers).toEqual(mockDispatchers);
  });

  it('inject 배열이 빈 배열이면 useFactory 가 인자 없이 호출 → 빈 array 반환', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: AGENT_DISPATCHER_PORT,
          useFactory: (...resolved: AgentDispatcher[]) => resolved,
          inject: [],
        },
      ],
    }).compile();

    const dispatchers = moduleRef.get<AgentDispatcher[]>(AGENT_DISPATCHER_PORT);

    expect(Array.isArray(dispatchers)).toBe(true);
    expect(dispatchers).toHaveLength(0);
  });
});
