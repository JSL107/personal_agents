import {
  displayTitle,
  fallbackTitle,
  validateShortTitle,
} from './display-title';

describe('할 일 표시 이름', () => {
  it.each([
    [
      'feat(sms): 문자 발송에 비속어(콘텐츠) 필터를 단다 — v5 규칙 공유',
      '문자 발송에 비속어(콘텐츠) 필터를 단다, v5 규칙 공유',
    ],
    [
      '기능 추가: (app-web) 서비스 메뉴에 상벌점 입장 추가',
      '(app-web) 서비스 메뉴에 상벌점 입장 추가',
    ],
    [
      '[BE] feat: EC2 CPU/로그 → Discord 알림 모니터링 인프라 추가',
      'EC2 CPU/로그 → Discord 알림 모니터링 인프라 추가',
    ],
    ['[personal_agents] feat: 일정 수집', '일정 수집'],
    ['버그 수정: 로그인 오류 해결', '로그인 오류 해결'],
  ])('접두와 줄표를 정리한다: %s', (input, expected) => {
    expect(fallbackTitle(input)).toBe(expected);
  });
  it('접두만 있는 제목은 원래 제목을 쓴다', () => {
    expect(fallbackTitle('feat:')).toBe('feat:');
  });
  it('긴 제목은 말줄임표를 포함해 40자다', () => {
    const title = fallbackTitle('가'.repeat(41));
    expect(title).toHaveLength(40);
    expect(title.endsWith('…')).toBe(true);
  });
  it('basis 가 같은 짧은 이름만 쓴다', () => {
    expect(
      displayTitle({
        title: 'feat: 원래 이름',
        shortTitle: '짧은 이름',
        shortTitleBasis: 'feat: 원래 이름',
      }),
    ).toBe('짧은 이름');
    expect(
      displayTitle({
        title: 'feat: 원래 이름',
        shortTitle: '짧은 이름',
        shortTitleBasis: '예전 이름',
      }),
    ).toBe('원래 이름');
  });
  it.each(['가'.repeat(31), '가 — 나', '가\n나', '#123', 'CODE_REVIEWER'])(
    '잘못된 짧은 이름을 거부한다: %s',
    (title) => {
      expect(validateShortTitle(title)).toBe(false);
    },
  );
  it('유효한 짧은 이름은 허용한다', () => {
    expect(validateShortTitle('일정 수집 개선')).toBe(true);
  });
});
