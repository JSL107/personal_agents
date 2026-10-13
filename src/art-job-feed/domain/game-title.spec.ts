import { extractGameTitle, normalizeTitleKey } from './game-title';

describe('game title', () => {
  it.each([
    [
      '[카오스 제로 나이트메어] 캐릭터 원화',
      '스마일게이트',
      '카오스 제로 나이트메어',
    ],
    ['[프로젝트 A] 캐릭터 원화', '회사', null],
    ['[넷마블네오] 캐릭터 원화', '넷마블네오㈜', null],
    ['[LOST ARK Mobile] 캐릭터 원화', '스마일게이트', 'LOST ARK Mobile'],
    ['[NC] 캐릭터 원화', '㈜엔씨소프트', 'NC'],
  ])('extracts %s', (title, company, expected) => {
    expect(extractGameTitle(title, company)).toBe(expected);
  });
  it('normalizes punctuation', () => {
    expect(normalizeTitleKey('LOST ARK-Mobile!')).toBe('lostarkmobile');
  });
});
