import {
  compareRevisionWindows,
  countRevision,
  summarizeRevisions,
} from './revision-rate';

describe('countRevision', () => {
  it('손대지 않은 글은 0%다', () => {
    const text = '첫 줄이에요.\n\n둘째 줄이에요.';

    expect(countRevision(text, text)).toEqual({
      addedLines: 0,
      removedLines: 0,
      totalLines: 3,
      percent: 0,
    });
  });

  it('한 줄을 고치면 추가와 삭제로 각각 잡힌다', () => {
    const published = '그대로 두는 줄이에요.\n고쳐질 줄이에요.';
    const final = '그대로 두는 줄이에요.\n고쳐진 줄이에요.';

    const count = countRevision(published, final);

    expect(count.addedLines).toBe(1);
    expect(count.removedLines).toBe(1);
    // 두 줄짜리 글에서 한 줄이 바뀌면 추가+삭제 2 / 원본 2 = 100%.
    expect(count.percent).toBe(100);
  });

  it('늘려 쓴 글은 100%를 넘는다', () => {
    // 실측(2026-08-20 발행본)에서 최종본이 발행본보다 길어져 125% 가 나왔다. 상한을 두면
    // 그 회차가 「많이 고쳤다」의 맨 끝에 뭉쳐 다른 회차와 구분되지 않는다.
    const published = '한 줄이에요.';
    const final = '한 줄이에요.\n덧붙인 줄이에요.\n또 덧붙인 줄이에요.';

    expect(countRevision(published, final).percent).toBe(200);
  });

  it('자리만 옮긴 줄은 고친 것으로 세지 않는다', () => {
    // 멀티셋 비교라 순서를 보지 않는다. 문단 이동을 수정으로 세면 문체를 하나도 안 고친
    // 회차가 크게 고친 것으로 보인다.
    const published = '앞 줄이에요.\n뒤 줄이에요.';
    const final = '뒤 줄이에요.\n앞 줄이에요.';

    expect(countRevision(published, final).percent).toBe(0);
  });

  it('같은 줄이 여러 번 나와도 개수만큼만 상쇄한다', () => {
    // 빈 줄처럼 반복되는 줄을 집합으로 다루면 개수 차이가 통째로 사라진다.
    const published = '같은 줄\n같은 줄\n같은 줄';
    const final = '같은 줄';

    const count = countRevision(published, final);

    expect(count.removedLines).toBe(2);
    expect(count.addedLines).toBe(0);
  });

  it('빈 글은 0으로 나누지 않는다', () => {
    expect(countRevision('', '').percent).toBe(0);
  });
});

describe('summarizeRevisions', () => {
  const count = (percent: number) => ({
    addedLines: 0,
    removedLines: 0,
    totalLines: 100,
    percent,
  });

  it('표본이 없으면 0으로 답한다', () => {
    expect(summarizeRevisions([])).toEqual({
      postCount: 0,
      averagePercent: 0,
      untouchedCount: 0,
    });
  });

  it('평균과 손대지 않은 글 수를 함께 낸다', () => {
    const summary = summarizeRevisions([count(50), count(0), count(70)]);

    expect(summary.postCount).toBe(3);
    expect(summary.averagePercent).toBe(40);
    expect(summary.untouchedCount).toBe(1);
  });
});

describe('compareRevisionWindows', () => {
  const now = new Date('2026-09-02T00:00:00Z');
  const daysAgo = (days: number): Date =>
    new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const row = (days: number, percent: number) => ({
    publishedAt: daysAgo(days),
    count: { addedLines: 0, removedLines: 0, totalLines: 100, percent },
  });

  it('두 구간이 모두 표본을 채우면 변화를 낸다', () => {
    const trend = compareRevisionWindows(
      [
        row(1, 30),
        row(3, 40),
        row(5, 50),
        row(9, 60),
        row(11, 70),
        row(13, 80),
      ],
      now,
      7,
    );

    expect(trend.recent.averagePercent).toBe(40);
    expect(trend.previous.averagePercent).toBe(70);
    // 음수가 개선이다 — 사람이 덜 고쳤다.
    expect(trend.changePercentPoint).toBe(-30);
  });

  it('한쪽 표본이 모자라면 변화를 내지 않는다', () => {
    // 표본 미달인데도 숫자를 내면 글 한 편이 눈금을 흔든 값이 판단 근거로 쓰인다.
    const trend = compareRevisionWindows([row(1, 30), row(9, 70)], now, 7);

    expect(trend.changePercentPoint).toBeNull();
  });

  it('창 밖의 글은 어느 구간에도 넣지 않는다', () => {
    const trend = compareRevisionWindows([row(30, 90)], now, 7);

    expect(trend.recent.postCount).toBe(0);
    expect(trend.previous.postCount).toBe(0);
  });
});
