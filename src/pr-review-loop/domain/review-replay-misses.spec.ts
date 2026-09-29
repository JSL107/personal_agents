import {
  parseMissedFindings,
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
      { ...valid, line: null, headSha: 'abc123' },
    ]);

    expect(errors).toEqual([]);
    expect(entries).toEqual([
      valid,
      { ...valid, line: null, headSha: 'abc123' },
    ]);
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
      '1번 항목: repo 는 owner/repo, line 은 양의 정수 또는 null',
      '2번 항목: headSha 는 비지 않은 문자열',
    ]);
  });

  it('배열이 아니면 오류', () => {
    expect(parseMissedFindings({}).errors).toEqual(['최상위가 배열이 아니다']);
  });
});

describe('toMissedLabeledFinding', () => {
  // 카드 id(양수)와 겹치지 않게 음수를 쓴다.
  it('MISSED 라벨과 음수 id 를 붙인다', () => {
    expect(toMissedLabeledFinding(valid, 0)).toMatchObject({
      id: -1,
      label: 'MISSED',
      filePath: 'Banner.ts',
      line: 258,
    });
  });
});
