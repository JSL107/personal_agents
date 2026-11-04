import {
  extractNumberTokens,
  hasUngroundedNumbers,
  isTestPassCount,
  shouldKeepPreviousTitle,
  validateCover,
} from './portfolio-cover.validate';
import { ProjectGroupNaming } from './project-group';

const cover = (
  overrides: Partial<ProjectGroupNaming> = {},
): ProjectGroupNaming => ({
  key: 'sample',
  title: '운영 관제',
  summary: '운영 상태를 한눈에 본다',
  problem: '장애를 찾기 어려웠다',
  result: '사망 3회가 0회로 줄었다',
  highlights: ['사망 3회 → 0회'],
  ...overrides,
});

describe('표지 숫자 근거', () => {
  it('18은 180과 다른 토큰으로 본다', () => {
    expect(hasUngroundedNumbers('18건', ['180건 처리'])).toBe(true);
  });

  it('쉼표 표기만 다른 정수는 같은 토큰으로 본다', () => {
    expect(hasUngroundedNumbers('24247건', ['24,247건 처리'])).toBe(false);
  });

  it('소수도 토큰 단위로 비교한다', () => {
    expect(extractNumberTokens('3.14와 3.1')).toEqual(['3.14', '3.1']);
    expect(hasUngroundedNumbers('3.1%', ['3.14% 감소'])).toBe(true);
  });
});

describe('표지 검증', () => {
  it('테스트 통과 수는 버리고 승인 통과율은 유지한다', () => {
    expect(isTestPassCount('단위 테스트 18개 통과')).toBe(true);
    expect(isTestPassCount('18 tests passed')).toBe(true);
    expect(isTestPassCount('승인 통과율 3%→0%')).toBe(false);
    const result = validateCover(
      cover({ highlights: ['테스트 3개 통과', '승인 통과율 3%→0%'] }),
      ['승인 통과율 3%→0%'],
      '',
    );
    expect(result?.highlights).toEqual(['승인 통과율 3%→0%']);
  });

  it('저장소와 PR 작업 건수는 성과 줄에서 제외한다', () => {
    const result = validateCover(
      cover({ highlights: ['8개 저장소 작업', 'PR 8건 처리'] }),
      ['8개 저장소 작업', 'PR 8건 처리'],
      '',
    );
    expect(result?.highlights).toEqual([]);
  });

  it('근거 없는 숫자와 작업 건수 문장을 제거하고 이전 결과를 검증해 대체한다', () => {
    const result = validateCover(
      cover({ result: '8개 PR 진행. 처리량 18건 달성' }),
      ['처리량 180건', '사망 3회 → 0회'],
      '사망 3회가 0회로 줄었다',
    );
    expect(result?.result).toBe('사망 3회가 0회로 줄었다');
  });

  it('남은 결과 문장을 이을 때 마침표가 겹치지 않는다', () => {
    const result = validateCover(
      cover({ result: '사망이 줄었다. 3개 PR 을 냈다. 관제가 쉬워졌다.' }),
      ['사망 3회 → 0회'],
      '',
    );
    expect(result?.result).toBe('사망이 줄었다. 관제가 쉬워졌다.');
  });

  it('성과 줄이 전부 제거되고 과정에 숫자가 있으면 한 번 더 요청한다', () => {
    const result = validateCover(
      cover({ highlights: ['테스트 3개 통과'] }),
      ['테스트 3개 통과'],
      '',
    );
    expect(result?.retryHighlights).toBe(true);
    expect(result?.removedHighlights).toEqual(['테스트 3개 통과']);
  });

  it('표지 필수 필드가 비면 카드를 버린다', () => {
    expect(validateCover(cover({ problem: '  ' }), [], '')).toBeNull();
  });
});

describe('이전 제목 유지', () => {
  it('Jaccard 0.8 경계는 유지하고 그 아래는 새 제목을 쓴다', () => {
    const row = { coverOf: 'hash', memberPrs: ['1', '2', '3', '4'] };
    expect(shouldKeepPreviousTitle(row, ['1', '2', '3', '4', '5'])).toBe(true);
    expect(shouldKeepPreviousTitle(row, ['1', '2', '3', '5', '6'])).toBe(false);
  });

  it('채택 행은 이전 제목을 붙잡지 않는다', () => {
    expect(
      shouldKeepPreviousTitle({ coverOf: null, memberPrs: ['1'] }, ['1']),
    ).toBe(false);
  });
});
