import { ConsoleAgentState } from '../domain/console.type';
import {
  bubbleForState,
  deriveAgentState,
  DeriveInput,
} from './derive-agent-state';

const base: DeriveInput = {
  hasOpenApproval: false,
  hasActiveRun: false,
  latestFinishedStatus: null,
  isIntegrationBlocked: false,
  isQueuedWaiting: false,
};

describe('deriveAgentState', () => {
  it('승인 대기가 최우선(활성 런보다 우선)', () => {
    expect(
      deriveAgentState({ ...base, hasOpenApproval: true, hasActiveRun: true }),
    ).toBe(ConsoleAgentState.AWAITING_APPROVAL);
  });

  it('연동 차단은 진행중보다 우선', () => {
    expect(
      deriveAgentState({
        ...base,
        isIntegrationBlocked: true,
        hasActiveRun: true,
      }),
    ).toBe(ConsoleAgentState.AWAITING_INTEGRATION);
  });

  it('활성 런이면 진행중', () => {
    expect(deriveAgentState({ ...base, hasActiveRun: true })).toBe(
      ConsoleAgentState.IN_PROGRESS,
    );
  });

  it('큐 대기면 대기', () => {
    expect(deriveAgentState({ ...base, isQueuedWaiting: true })).toBe(
      ConsoleAgentState.WAITING,
    );
  });

  it('성공 종료 후 아무 대기 없으면 완료', () => {
    expect(
      deriveAgentState({ ...base, latestFinishedStatus: 'SUCCEEDED' }),
    ).toBe(ConsoleAgentState.COMPLETED);
  });

  it('실패 종료만 있고 다른 신호 없으면 대기(과표시 방지)', () => {
    expect(deriveAgentState({ ...base, latestFinishedStatus: 'FAILED' })).toBe(
      ConsoleAgentState.WAITING,
    );
  });

  it('아무 신호 없으면 대기(기본 안전값)', () => {
    expect(deriveAgentState(base)).toBe(ConsoleAgentState.WAITING);
  });
});

describe('bubbleForState', () => {
  it('모든 상태에 비어있지 않은 말풍선이 있다', () => {
    for (const state of Object.values(ConsoleAgentState)) {
      expect(bubbleForState(state).length).toBeGreaterThan(0);
    }
  });
});
