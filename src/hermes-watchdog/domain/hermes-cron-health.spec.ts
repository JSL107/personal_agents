import {
  detectHermesCronIssues,
  formatHermesCronIssues,
  HERMES_CRON_ISSUE,
} from './hermes-cron-health';
import { HermesCronJobSnapshot } from './hermes-watchdog.type';

// 2026-09-18 08:00 실제 실패 회차의 jobs.json 스냅샷 (codex 쿼터 소진).
// 값을 지어내지 않고 그날 파일에서 그대로 옮겼다 — 이 감시자가 막으려던 바로 그 사고다.
const MORNING_NEWS_FAILURE: HermesCronJobSnapshot = {
  id: '91a2c90c75b8',
  name: '아침신문',
  enabled: true,
  last_status: 'error',
  last_error:
    'RuntimeError: No Codex credentials stored. Run `hermes auth` to authenticate. Run `hermes model` to re-authenticate.',
  last_run_at: '2026-09-18T08:00:12.874903+09:00',
  last_delivery_error: null,
  next_run_at: '2026-09-19T08:00:00+09:00',
};

// 점검이 도는 시각 — 실패 당일 08:30 KST.
const CHECKED_AT_MS = Date.parse('2026-09-18T08:30:00+09:00');

describe('detectHermesCronIssues', () => {
  it('2026-09-18 실제 실패 스냅샷에서 실행 실패를 잡아낸다', () => {
    const issues = detectHermesCronIssues({
      jobs: [MORNING_NEWS_FAILURE],
      nowMs: CHECKED_AT_MS,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual({
      jobName: '아침신문',
      kind: HERMES_CRON_ISSUE.LAST_RUN_FAILED,
      detail: MORNING_NEWS_FAILURE.last_error,
    });
  });

  it('실행은 실패했어도 다음 예정 시각이 미래면 스케줄러 멈춤으로 보지 않는다', () => {
    const issues = detectHermesCronIssues({
      jobs: [MORNING_NEWS_FAILURE],
      nowMs: CHECKED_AT_MS,
    });

    const stalled = issues.filter(
      (issue) => issue.kind === HERMES_CRON_ISSUE.SCHEDULER_STALLED,
    );
    expect(stalled).toHaveLength(0);
  });

  it('정상 회차는 아무것도 보고하지 않는다', () => {
    const issues = detectHermesCronIssues({
      jobs: [
        {
          ...MORNING_NEWS_FAILURE,
          last_status: 'ok',
          last_error: null,
        },
      ],
      nowMs: CHECKED_AT_MS,
    });

    expect(issues).toEqual([]);
  });

  it('꺼둔 job 은 실패 상태여도 건너뛴다', () => {
    const issues = detectHermesCronIssues({
      jobs: [{ ...MORNING_NEWS_FAILURE, enabled: false }],
      nowMs: CHECKED_AT_MS,
    });

    expect(issues).toEqual([]);
  });

  it('예정 시각이 임계를 넘겨 지났으면 스케줄러 멈춤으로 본다', () => {
    const issues = detectHermesCronIssues({
      jobs: [
        {
          ...MORNING_NEWS_FAILURE,
          last_status: 'ok',
          last_error: null,
          // 점검 시각보다 2시간 전 — Hermes 가 이 회차를 소비하지 못했다.
          next_run_at: '2026-09-18T06:30:00+09:00',
        },
      ],
      nowMs: CHECKED_AT_MS,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe(HERMES_CRON_ISSUE.SCHEDULER_STALLED);
  });

  it('예정 시각이 조금 지난 정도(임계 이내)면 보고하지 않는다', () => {
    const issues = detectHermesCronIssues({
      jobs: [
        {
          ...MORNING_NEWS_FAILURE,
          last_status: 'ok',
          last_error: null,
          // 30분 전 — 실행 직후 갱신 전 구간이라 정상으로 본다.
          next_run_at: '2026-09-18T08:00:00+09:00',
        },
      ],
      nowMs: CHECKED_AT_MS,
    });

    expect(issues).toEqual([]);
  });

  it('전달 실패는 실행 실패와 별개로 보고한다', () => {
    const issues = detectHermesCronIssues({
      jobs: [
        {
          ...MORNING_NEWS_FAILURE,
          last_delivery_error: 'slack: channel_not_found',
        },
      ],
      nowMs: CHECKED_AT_MS,
    });

    expect(issues.map((issue) => issue.kind)).toEqual([
      HERMES_CRON_ISSUE.LAST_RUN_FAILED,
      HERMES_CRON_ISSUE.DELIVERY_FAILED,
    ]);
  });

  it('예정 시각을 해석할 수 없으면 근거가 없으므로 보고하지 않는다', () => {
    const issues = detectHermesCronIssues({
      jobs: [
        {
          ...MORNING_NEWS_FAILURE,
          last_status: 'ok',
          last_error: null,
          next_run_at: '알 수 없음',
        },
      ],
      nowMs: CHECKED_AT_MS,
    });

    expect(issues).toEqual([]);
  });

  it('이름이 없으면 id 로 어느 job 인지 알린다', () => {
    const issues = detectHermesCronIssues({
      jobs: [{ ...MORNING_NEWS_FAILURE, name: '   ' }],
      nowMs: CHECKED_AT_MS,
    });

    expect(issues[0].jobName).toBe('91a2c90c75b8');
  });

  it('last_error 가 비어 있어도 실패 사실은 알린다', () => {
    const issues = detectHermesCronIssues({
      jobs: [{ ...MORNING_NEWS_FAILURE, last_error: null }],
      nowMs: CHECKED_AT_MS,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toBe('(last_error 가 비어 있음)');
  });

  it('긴 에러 메시지는 잘라 담는다', () => {
    const issues = detectHermesCronIssues({
      jobs: [{ ...MORNING_NEWS_FAILURE, last_error: 'x'.repeat(1000) }],
      nowMs: CHECKED_AT_MS,
    });

    expect(issues[0].detail).toHaveLength(401);
    expect(issues[0].detail.endsWith('…')).toBe(true);
  });
});

describe('formatHermesCronIssues', () => {
  it('종류를 한국어 라벨로 붙여 한 줄씩 나열한다', () => {
    const text = formatHermesCronIssues([
      {
        jobName: '아침신문',
        kind: HERMES_CRON_ISSUE.LAST_RUN_FAILED,
        detail: 'boom',
      },
      {
        jobName: '아침신문',
        kind: HERMES_CRON_ISSUE.SCHEDULER_STALLED,
        detail: 'stuck',
      },
    ]);

    expect(text).toBe(
      '• [실행 실패] 아침신문 — boom\n• [스케줄러 멈춤] 아침신문 — stuck',
    );
  });
});
