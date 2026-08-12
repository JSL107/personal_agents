import {
  ActiveRunSnapshot,
  FailedRunDetail,
} from '../../agent-run/domain/port/agent-run.repository.port';
import { PreviewAction } from '../../preview-gate/domain/preview-action.type';
import {
  buildSecretariatDigest,
  isSecretariatDigestEmpty,
} from './secretariat.digest';

const NOW = new Date('2026-08-03T00:00:00.000Z');

const done = (agentType: string, succeeded: number) => ({
  agentType,
  succeeded,
});

const activeRun = (agentType: string, startedAt: Date): ActiveRunSnapshot => ({
  id: 1,
  agentType,
  status: 'IN_PROGRESS',
  parentId: null,
  startedAt,
  endedAt: null,
  triggerType: 'SCHEDULED',
  inputSnapshot: null,
});

const preview = (previewText: string, expiresAt: Date): PreviewAction =>
  ({
    id: 'preview-1',
    slackUserId: 'U1',
    kind: 'PM_WRITE_BACK',
    payload: {},
    status: 'PENDING',
    previewText,
    responseUrl: null,
    expiresAt,
  }) as PreviewAction;

const failedRun = (
  agentType: string,
  reason: string,
  endedAt: Date,
): FailedRunDetail => ({ agentType, reason, endedAt });

const build = (
  overrides: Partial<Parameters<typeof buildSecretariatDigest>[0]> = {},
) =>
  buildSecretariatDigest({
    succeeded: [],
    activeRuns: [],
    openPreviews: [],
    failedRuns: [],
    // 기본은 "실패한 것은 전부 미복구" — 복구 필터를 따로 검증하는 테스트에서만 좁힌다.
    unresolvedAgentTypes: ['PM', 'CEO', 'CODE_REVIEWER'],
    now: NOW,
    ...overrides,
  });

describe('buildSecretariatDigest', () => {
  describe('① 완료', () => {
    it('성공 건수만 세고 많은 순으로 정렬한다', () => {
      const digest = build({
        succeeded: [done('PM', 1), done('WORK_REVIEWER', 3)],
      });

      expect(digest.completed).toEqual([
        { agentType: 'WORK_REVIEWER', count: 3 },
        { agentType: 'PM', count: 1 },
      ]);
    });

    it('성공이 0건인 에이전트는 완료에 넣지 않는다', () => {
      const digest = build({ succeeded: [done('PM', 0)] });

      expect(digest.completed).toEqual([]);
    });

    it('진행 중인 실행은 완료로 세지 않는다', () => {
      // aggregateRunStats.total 은 상태를 가리지 않고 세므로 `total - failed` 로 계산하면
      // 지금 돌고 있는 런이 ① 완료와 ② 진행 중에 동시에 나타났다. 성공만 세는 별도
      // 집계(aggregateSucceededCounts)를 쓰는 이유다.
      const digest = build({
        succeeded: [done('PM', 1)],
        activeRuns: [activeRun('PM', NOW), activeRun('PM', NOW)],
      });

      expect(digest.completed).toEqual([{ agentType: 'PM', count: 1 }]);
      expect(digest.inProgress).toEqual(['PM']);
    });
  });

  describe('② 진행 중', () => {
    it('좀비 임계(30분)를 넘긴 실행은 진행 중으로 세지 않는다', () => {
      // run-sweeper 가 주 1회라, 걸러내지 않으면 죽은 런이 며칠씩 "일하는 중" 으로 남는다.
      const digest = build({
        activeRuns: [
          activeRun('PM', new Date(NOW.getTime() - 5 * 60_000)),
          activeRun('CEO', new Date(NOW.getTime() - 31 * 60_000)),
        ],
      });

      expect(digest.inProgress).toEqual(['PM']);
    });

    it('같은 에이전트가 여러 건이면 한 번만 센다', () => {
      const digest = build({
        activeRuns: [
          activeRun('PM', NOW),
          activeRun('PM', NOW),
          activeRun('CTO', NOW),
        ],
      });

      expect(digest.inProgress).toEqual(['CTO', 'PM']);
    });
  });

  describe('④ 막힌 것 — 복구 필터', () => {
    it('이후 성공으로 복구된 에이전트는 막힌 것에서 뺀다', () => {
      // 실패 목록에는 재시도가 성공해 이미 해결된 건도 남아 있다. 그것까지 보고하면
      // 대표가 이미 끝난 문제를 다시 들여다보게 된다.
      const digest = build({
        failedRuns: [
          failedRun('PM', '복구됨', new Date('2026-08-02T09:00:00.000Z')),
          failedRun('CEO', '미복구', new Date('2026-08-02T08:00:00.000Z')),
        ],
        unresolvedAgentTypes: ['CEO'],
      });

      expect(digest.blocked).toEqual([
        { agentType: 'CEO', reason: '미복구', count: 1 },
      ]);
    });

    it('사이에 성공이 있어 복구된 반복 실패는 결정거리로 올리지 않는다', () => {
      const digest = build({
        failedRuns: [
          failedRun('PM', '실패', new Date('2026-08-02T09:00:00.000Z')),
          failedRun('PM', '실패', new Date('2026-08-02T07:00:00.000Z')),
        ],
        unresolvedAgentTypes: [],
      });

      expect(digest.blocked).toEqual([]);
      expect(digest.decision).toBeNull();
    });
  });

  describe('④ 막힌 것', () => {
    it('에이전트별로 묶어 건수를 세고 가장 최근 이유를 남긴다', () => {
      const digest = build({
        failedRuns: [
          failedRun('PM', '오래된 이유', new Date('2026-08-02T01:00:00.000Z')),
          failedRun('PM', '최근 이유', new Date('2026-08-02T09:00:00.000Z')),
          failedRun('CEO', '단발 실패', new Date('2026-08-02T05:00:00.000Z')),
        ],
      });

      expect(digest.blocked).toEqual([
        { agentType: 'PM', reason: '최근 이유', count: 2 },
        { agentType: 'CEO', reason: '단발 실패', count: 1 },
      ]);
    });
  });

  describe('⑤ 오늘 결정할 것', () => {
    it('읽고 반응할 시간이 남은 카드 중 가장 임박한 1건을 올린다', () => {
      const soon = new Date(NOW.getTime() + 2 * 3600_000);
      const later = new Date(NOW.getTime() + 20 * 3600_000);
      const digest = build({
        openPreviews: [preview('나중 카드', later), preview('급한 카드', soon)],
      });

      expect(digest.decision).toEqual({
        kind: 'APPROVAL',
        label: '급한 카드',
        expiresAt: soon,
      });
      // 목록도 임박한 순이어야 결정 후보와 첫 줄이 일치한다.
      expect(digest.approvals.map((row) => row.label)).toEqual([
        '급한 카드',
        '나중 카드',
      ]);
    });

    it('곧 만료될 카드는 결정거리로 올리지 않는다 (읽을 때쯤 사라진다)', () => {
      // 실측: TTL 30분짜리 세션 주입 카드가 "3분 뒤 만료" 로 1순위를 차지했다.
      // 목록(③)에는 남기되 오늘 할 일(⑤)로는 올리지 않는다.
      const digest = build({
        openPreviews: [
          preview('3분 남은 카드', new Date(NOW.getTime() + 3 * 60_000)),
        ],
      });

      expect(digest.approvals).toHaveLength(1);
      expect(digest.decision).toBeNull();
    });

    it('임박한 카드를 건너뛰고 시간이 남은 다음 카드를 고른다', () => {
      const tooSoon = new Date(NOW.getTime() + 3 * 60_000);
      const usable = new Date(NOW.getTime() + 5 * 3600_000);
      const digest = build({
        openPreviews: [
          preview('곧 만료', tooSoon),
          preview('여유 있음', usable),
        ],
      });

      expect(digest.decision).toEqual({
        kind: 'APPROVAL',
        label: '여유 있음',
        expiresAt: usable,
      });
    });

    it('승인 카드가 없으면 2건 이상 미복구 실패를 올린다', () => {
      const digest = build({
        failedRuns: [
          failedRun(
            'PM',
            '모델 호출 실패',
            new Date('2026-08-02T09:00:00.000Z'),
          ),
          failedRun(
            'PM',
            '모델 호출 실패',
            new Date('2026-08-02T08:00:00.000Z'),
          ),
        ],
      });

      expect(digest.decision).toEqual({
        kind: 'UNRESOLVED_FAILURE',
        agentType: 'PM',
        reason: '모델 호출 실패',
        count: 2,
      });
    });

    it('실패가 1회뿐이면 결정거리로 올리지 않는다 (다음 슬롯이 재시도한다)', () => {
      const digest = build({
        failedRuns: [
          failedRun('PM', '일시적 실패', new Date('2026-08-02T09:00:00.000Z')),
        ],
      });

      expect(digest.decision).toBeNull();
      expect(digest.blocked).toHaveLength(1);
    });

    it('승인 카드가 반복 실패보다 먼저다 (카드는 만료되면 유실된다)', () => {
      const expiresAt = new Date(NOW.getTime() + 3600_000);
      const digest = build({
        openPreviews: [preview('승인 카드', expiresAt)],
        failedRuns: [
          failedRun('PM', '실패', new Date('2026-08-02T09:00:00.000Z')),
          failedRun('PM', '실패', new Date('2026-08-02T08:00:00.000Z')),
        ],
      });

      expect(digest.decision).toEqual({
        kind: 'APPROVAL',
        label: '승인 카드',
        expiresAt,
      });
    });
  });

  it('승인 카드 제목은 첫 줄만 쓰고 60자를 넘으면 줄인다', () => {
    const long = 'ㄱ'.repeat(70);
    const digest = build({
      openPreviews: [preview(`${long}\n두 번째 줄`, NOW)],
    });

    expect(digest.approvals[0].label).toBe(`${'ㄱ'.repeat(60)}…`);
  });
});

describe('isSecretariatDigestEmpty', () => {
  it('네 항목이 모두 비면 보고하지 않는다', () => {
    expect(isSecretariatDigestEmpty(build())).toBe(true);
  });

  it('하나라도 있으면 보고한다', () => {
    expect(
      isSecretariatDigestEmpty(build({ succeeded: [done('PM', 1)] })),
    ).toBe(false);
  });
});
