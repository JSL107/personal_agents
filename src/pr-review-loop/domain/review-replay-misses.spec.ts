import {
  missedFindingId,
  pairReplacementMisses,
  parseMissedFindings,
  resolveMissPath,
  toMissedLabeledFinding,
} from './review-replay-misses';

const valid = {
  repo: 'owner/app',
  pullNumber: 12,
  filePath: 'Banner.ts',
  line: 258,
  body: '정렬 비교가 NaN',
};

describe('parseMissedFindings', () => {
  it('올바른 항목을 읽고 headSha 는 있을 때만 싣는다', () => {
    const { entries, errors } = parseMissedFindings([
      valid,
      { ...valid, headSha: 'abc123' },
    ]);

    expect(errors).toEqual([]);
    expect(entries).toEqual([valid, { ...valid, headSha: 'abc123' }]);
  });

  // 틀린 항목을 조용히 버리면 표본이 줄어든 채 재현율이 나온다.
  it('틀린 항목은 버리지 않고 번호와 사유를 모은다', () => {
    const { entries, errors } = parseMissedFindings([
      valid,
      { ...valid, repo: 'no-slash', line: 0 },
      { ...valid, headSha: '' },
    ]);

    expect(entries).toHaveLength(1);
    expect(errors).toEqual([
      '1번 항목: repo 는 owner/repo, line 은 양의 정수',
      '2번 항목: headSha 는 비지 않은 문자열',
    ]);
  });

  // 미탐은 분류가 없어 줄 없이는 재생 지적과 맞출 근거가 없다 — 받으면 재현율이 늘 0 이 된다.
  it('줄 번호가 없는 항목은 거부한다', () => {
    expect(parseMissedFindings([{ ...valid, line: null }]).errors).toEqual([
      '0번 항목: line 은 양의 정수',
    ]);
  });

  it('배열이 아니면 오류', () => {
    expect(parseMissedFindings({}).errors).toEqual(['최상위가 배열이 아니다']);
  });
});

describe('missedFindingId · toMissedLabeledFinding', () => {
  // 목록 순서로 번호를 매기면 다른 결함이 같은 id 를 받아 기준선 표본 비교가 틀린다.
  it('같은 결함은 목록 위치와 무관하게 같은 음수 id', () => {
    const other = { ...valid, line: 300 };
    const first = parseMissedFindings([valid, other]).entries;
    const reordered = parseMissedFindings([other, valid]).entries;

    expect(missedFindingId(first[0])).toBe(missedFindingId(reordered[1]));
    expect(missedFindingId(valid)).toBeLessThan(0);
  });

  it('내용이 다르면 id 가 다르다', () => {
    expect(missedFindingId(valid)).not.toBe(
      missedFindingId({ ...valid, body: '다른 결함' }),
    );
    expect(missedFindingId(valid)).not.toBe(
      missedFindingId({ ...valid, pullNumber: 13 }),
    );
  });

  it('MISSED 라벨로 바꾼다', () => {
    expect(toMissedLabeledFinding(valid)).toMatchObject({
      id: missedFindingId(valid),
      label: 'MISSED',
      filePath: 'Banner.ts',
      line: 258,
    });
  });
});

describe('resolveMissPath', () => {
  const changed = ['src/a/index.ts', 'src/b/index.ts', 'src/models/Banner.ts'];

  it('변경 파일 중 이름이 하나만 맞으면 전체 경로로 바꾼다', () => {
    expect(resolveMissPath('Banner.ts', changed)).toEqual({
      kind: 'resolved',
      filePath: 'src/models/Banner.ts',
    });
  });

  // 같은 PR 의 동명 파일 중 어느 쪽인지 모르면 바꾸지 않고 알린다.
  it('동명 파일이 여럿이면 후보와 함께 ambiguous', () => {
    expect(resolveMissPath('index.ts', changed)).toEqual({
      kind: 'ambiguous',
      filePath: 'index.ts',
      candidates: ['src/a/index.ts', 'src/b/index.ts'],
    });
  });

  it('diff 에 없으면 not-in-diff', () => {
    expect(resolveMissPath('Other.ts', changed).kind).toBe('not-in-diff');
  });

  it('이미 경로가 있으면 그대로', () => {
    expect(resolveMissPath('src/x/Banner.ts', changed)).toEqual({
      kind: 'full',
      filePath: 'src/x/Banner.ts',
    });
  });
});

describe('pairReplacementMisses', () => {
  const replacement = {
    ...valid,
    filePath: 'src/x/Banner.ts',
    line: 256,
    body: '외부 리뷰 원문',
    headSha: 'abc123',
  };

  // id 를 새 내용으로 다시 만들면 저장된 보고서의 결과와 짝이 끊긴다.
  it('본문·줄·경로는 교체 목록에서, id 는 원래 목록에서 가져온다', () => {
    const { labeled, errors } = pairReplacementMisses([valid], [replacement]);

    expect(errors).toEqual([]);
    expect(labeled).toEqual([
      {
        id: missedFindingId(valid),
        label: 'MISSED',
        filePath: 'src/x/Banner.ts',
        line: 256,
        category: '',
        body: '외부 리뷰 원문',
      },
    ]);
  });

  it('항목 수가 다르면 짝짓지 않는다', () => {
    const { labeled, errors } = pairReplacementMisses([valid, valid], [valid]);

    expect(labeled).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it('같은 순서의 PR 이 다르면 번호와 함께 거부한다', () => {
    const { labeled, errors } = pairReplacementMisses(
      [valid],
      [{ ...replacement, pullNumber: 13 }],
    );

    expect(labeled).toEqual([]);
    expect(errors[0]).toContain('0번');
  });
});
