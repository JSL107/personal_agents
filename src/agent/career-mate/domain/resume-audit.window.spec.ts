import { ProfileAccomplishment } from './career-mate.type';
import {
  RESUME_AUDIT_WINDOW_SIZE,
  selectAuditWindow,
} from './resume-audit.window';

const buildAccomplishment = (index: number): ProfileAccomplishment => ({
  title: `성과 ${index}`,
  bullet: 'bullet',
  star: { situation: 's', task: 't', action: 'a', result: 'r' },
  techTags: [],
  evidence: [],
});

const buildAccomplishments = (count: number): ProfileAccomplishment[] =>
  Array.from({ length: count }, (_, index) => buildAccomplishment(index + 1));

describe('selectAuditWindow', () => {
  it('상한 이하면 전량을 그대로 준다 — 종전 동작과 같다', () => {
    const accomplishments = buildAccomplishments(RESUME_AUDIT_WINDOW_SIZE);

    const window = selectAuditWindow({
      accomplishments,
      todayKst: '2026-09-11',
    });

    expect(window.selected).toEqual(accomplishments);
    expect(window.outOfWindowTitles).toEqual([]);
    // 전량을 본 회차에 범위 표기를 붙이면 "일부만 봤다" 는 인상이 잘못 생긴다.
    expect(window.label).toBeNull();
  });

  it('상한을 넘으면 창 크기만큼만 고르고 나머지를 범위 밖으로 돌린다', () => {
    const accomplishments = buildAccomplishments(85);

    const window = selectAuditWindow({
      accomplishments,
      todayKst: '2026-09-11',
    });

    expect(window.selected).toHaveLength(RESUME_AUDIT_WINDOW_SIZE);
    expect(window.outOfWindowTitles).toHaveLength(
      85 - RESUME_AUDIT_WINDOW_SIZE,
    );
    expect(window.label).toContain('전체 85건');
  });

  // 창을 고정하면 그 밖의 성과가 영영 판정되지 않는다. 날짜로 굴려 며칠이면 한 바퀴 돈다.
  it('날짜가 바뀌면 창이 이동하고, 며칠이면 전량을 한 번씩 덮는다', () => {
    const accomplishments = buildAccomplishments(85);
    const dates = ['2026-09-11', '2026-09-12', '2026-09-13'];

    const covered = new Set<string>();
    const starts: number[] = [];
    for (const todayKst of dates) {
      const window = selectAuditWindow({ accomplishments, todayKst });
      starts.push(accomplishments.indexOf(window.selected[0]));
      for (const item of window.selected) {
        covered.add(item.title);
      }
    }

    // 85 건 / 창 30 = 3 구간이므로 사흘이면 전량을 덮는다.
    expect(covered.size).toBe(85);
    // 서로 다른 구간을 봤는지 — 같은 자리를 반복하면 위 덮개 검사도 같이 깨지지만,
    // 실패했을 때 원인이 "이동을 안 했다" 임을 바로 보이게 따로 확인한다.
    expect(new Set(starts).size).toBe(3);
  });

  it('같은 날짜는 같은 창을 준다 — 재시도가 다른 구간을 보지 않는다', () => {
    const accomplishments = buildAccomplishments(85);

    const first = selectAuditWindow({
      accomplishments,
      todayKst: '2026-09-11',
    });
    const second = selectAuditWindow({
      accomplishments,
      todayKst: '2026-09-11',
    });

    expect(second.selected).toEqual(first.selected);
  });

  it('선택과 범위 밖은 서로 겹치지 않고 합치면 전량이다', () => {
    const accomplishments = buildAccomplishments(85);

    const window = selectAuditWindow({
      accomplishments,
      todayKst: '2026-09-12',
    });

    const selectedTitles = window.selected.map((item) => item.title);
    const union = new Set([...selectedTitles, ...window.outOfWindowTitles]);
    expect(union.size).toBe(85);
    expect(selectedTitles).not.toEqual(
      expect.arrayContaining(window.outOfWindowTitles),
    );
  });

  // 회차를 통째로 잃느니 같은 구간을 반복해서라도 감사가 도는 쪽이 낫다.
  it('날짜를 못 읽으면 맨 앞 창으로 떨어진다', () => {
    const accomplishments = buildAccomplishments(85);

    const window = selectAuditWindow({
      accomplishments,
      todayKst: '날짜아님',
    });

    expect(window.selected[0].title).toBe('성과 1');
    expect(window.selected).toHaveLength(RESUME_AUDIT_WINDOW_SIZE);
  });

  it('창 크기가 0 이하로 들어오면 전량을 본다 — 빈 창으로 회차를 날리지 않는다', () => {
    const accomplishments = buildAccomplishments(85);

    const window = selectAuditWindow({
      accomplishments,
      todayKst: '2026-09-11',
      windowSize: 0,
    });

    expect(window.selected).toHaveLength(85);
    expect(window.label).toBeNull();
  });

  it('마지막 창은 남은 만큼만 담는다', () => {
    const accomplishments = buildAccomplishments(85);

    // 3 구간 중 마지막(60~84)을 고르는 날짜를 찾아 확인한다.
    const lastWindow = ['2026-09-11', '2026-09-12', '2026-09-13']
      .map((todayKst) => selectAuditWindow({ accomplishments, todayKst }))
      .find((window) => window.selected.length < RESUME_AUDIT_WINDOW_SIZE);

    expect(lastWindow).toBeDefined();
    expect(lastWindow?.selected).toHaveLength(
      85 - RESUME_AUDIT_WINDOW_SIZE * 2,
    );
    expect(lastWindow?.label).toBe('61~85번째 / 전체 85건');
  });
});
