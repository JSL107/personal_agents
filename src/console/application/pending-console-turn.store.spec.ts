import { AgentType } from '../../model-router/domain/model-router.type';
import { WorkSuggestion } from '../domain/work-suggestion.type';
import { PendingConsoleTurnStore } from './pending-console-turn.store';

const SUGGESTIONS: readonly WorkSuggestion[] = [
  {
    agentType: AgentType.PM,
    displayName: 'PM',
    reason: '마지막 성공 2일 전 · 평소 1일 주기',
  },
];

describe('PendingConsoleTurnStore', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('SUGGESTIONS 상태는 putAwaitingInput이 한 사용자의 상태로 덮어쓴다', () => {
    const store = new PendingConsoleTurnStore();
    store.putSuggestions('U1', SUGGESTIONS);

    store.putAwaitingInput('U1', {
      agentType: AgentType.WORK_REVIEWER,
      displayName: 'Work Reviewer',
    });

    expect(store.peek('U1')).toEqual({
      kind: 'AWAITING_INPUT',
      agentType: AgentType.WORK_REVIEWER,
      displayName: 'Work Reviewer',
    });
  });

  it('30분 TTL 만료 뒤 peek은 항목을 지우고 null을 반환한다', () => {
    const store = new PendingConsoleTurnStore();
    store.putAwaitingInput('U1', {
      agentType: AgentType.WORK_REVIEWER,
      displayName: 'Work Reviewer',
    });
    jest.advanceTimersByTime(30 * 60 * 1000 + 1);

    expect(store.peek('U1')).toBeNull();
    expect(store.peek('U1')).toBeNull();
  });

  it('consume 뒤에는 peek이 null을 반환한다', () => {
    const store = new PendingConsoleTurnStore();
    store.putSuggestions('U1', SUGGESTIONS);

    store.consume('U1');

    expect(store.peek('U1')).toBeNull();
  });
});
