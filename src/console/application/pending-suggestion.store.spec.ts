import { AgentType } from '../../model-router/domain/model-router.type';
import { WorkSuggestion } from '../domain/work-suggestion.type';
import { PendingSuggestionStore } from './pending-suggestion.store';

const SUGGESTIONS: readonly WorkSuggestion[] = [
  {
    agentType: AgentType.PM,
    displayName: 'PM',
    reason: '마지막 성공 2일 전 · 평소 1일 주기',
  },
];

describe('PendingSuggestionStore', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('put 30분 뒤에는 peek이 만료 항목을 지우고 빈 배열을 반환한다', () => {
    const store = new PendingSuggestionStore();
    store.put('U1', SUGGESTIONS);
    jest.advanceTimersByTime(30 * 60 * 1000 + 1);

    expect(store.peek('U1')).toEqual([]);
    expect(store.peek('U1')).toEqual([]);
  });

  it('consume 뒤에는 peek이 빈 배열을 반환한다', () => {
    const store = new PendingSuggestionStore();
    store.put('U1', SUGGESTIONS);

    store.consume('U1');

    expect(store.peek('U1')).toEqual([]);
  });
});
