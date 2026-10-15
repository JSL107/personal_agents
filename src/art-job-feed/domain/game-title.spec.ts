import {
  extractGameTitle,
  normalizeTitleKey,
  splitRepresentativeGames,
} from './game-title';

describe('game title', () => {
  it.each([
    [
      '[카오스 제로 나이트메어] 캐릭터 원화',
      '스마일게이트',
      '카오스 제로 나이트메어',
    ],
    ['[프로젝트 A] 캐릭터 원화', '회사', null],
    ['[구인] 캐릭터 원화', '엔더블유', null],
    ['[Ex2게임즈] 프로젝트K', '㈜이엑스투게임즈', null],
    ['[로켓점프4기] 아트 인턴십', '게임듀오', null],
    ['[넷마블네오] 캐릭터 원화', '넷마블네오㈜', null],
    ['[LOST ARK Mobile] 캐릭터 원화', '스마일게이트', 'LOST ARK Mobile'],
    ['[NC] 캐릭터 원화', '㈜엔씨소프트', 'NC'],
    ['[Team Tetrapod] 추리게임 아트 모집', '㈜팀 테트라포드', null],
    ['[일본IP] 캐릭터 원화', '네오위즈', null],
    ['[Battleship] 캐릭터 원화', '회사', 'Battleship'],
  ])('extracts %s', (title, company, expected) => {
    expect(extractGameTitle(title, company)).toBe(expected);
  });
  it('normalizes punctuation', () => {
    expect(normalizeTitleKey('LOST ARK-Mobile!')).toBe('lostarkmobile');
  });
  it('로마 숫자를 숫자로 바꿔 남긴다', () => {
    expect(normalizeTitleKey('리니지Ⅱ')).toBe('리니지2');
    expect(normalizeTitleKey('파이널판타지 Ⅻ')).toBe('파이널판타지12');
    expect(normalizeTitleKey('ⅳ')).toBe('4');
  });
});

describe('splitRepresentativeGames', () => {
  it('쉼표·등·주소를 걷어내고 최대 3개까지 나눈다', () => {
    expect(splitRepresentativeGames('리니지, 리니지Ⅱ, AION 등')).toEqual([
      '리니지',
      '리니지Ⅱ',
      'AION',
    ]);
    expect(
      splitRepresentativeGames('스타세이비어 (https://www.starsavior.com/kr)'),
    ).toEqual(['스타세이비어']);
    expect(
      splitRepresentativeGames(
        '메이플스토리, 던전앤파이터, 카트라이더, 마비노기',
      ),
    ).toHaveLength(3);
  });

  it('미공개 코드명은 빼고, Project 로 시작하는 출시작은 남긴다', () => {
    expect(
      splitRepresentativeGames('템빨:오버기어드 , 프로젝트A, Project S'),
    ).toEqual(['템빨:오버기어드']);
    expect(splitRepresentativeGames('Project Zomboid, Project EA')).toEqual([
      'Project Zomboid',
    ]);
  });
});
