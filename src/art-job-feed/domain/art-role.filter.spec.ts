import { isTargetArtRole } from './art-role.filter';

// 제목은 전부 2026-10-13 게임잡 원화 직종 실측.
describe('isTargetArtRole', () => {
  it.each([
    '[카오스 제로 나이트메어] 캐릭터 원화',
    '[LOST ARK Mobile] 캐릭터컨셉(원화) 담당',
    '[외주/프리랜서] 캐릭터 의상 원화 디자이너 모집 - 서브컬쳐 애니메 그림체',
    '[프로젝트 A] 캐릭터 원화, 일러스트 제작',
    // 넓힌 범위 — 캐주얼 / 아티스트 / 2D 게임 그래픽 / 디자이너 / 일러스트 / 픽셀
    'RPG 게임 그래픽 디자이너 님을 모십니다.(전면 재택 근무)',
    '[빌리언플레이] 2D 캐주얼 게임 그래픽 디자이너 모집',
    '[협동탈출프로젝트] 2D 게임 그래픽 디자이너',
    '[메이플스타/MSW] 게임 아티스트',
    '[이터널 리턴] 일러스트 외주 작가 모집',
    '[프로젝트 BB] 픽셀아티스트',
    '2D 아트 디자이너',
    '캐릭터/배경 원화가 모집',
  ])('includes %s', (title) => {
    expect(isTargetArtRole(title)).toBe(true);
  });

  it.each([
    '[마비노기 모바일] 3D 캐릭터 모델러 모집',
    '[Project EA] 리드 애니메이터',
    '[LOST ARK Mobile] 배경원화(컨셉) 담당',
    '[넷마블네오] 블룸워커 캐릭터모델링 담당 모집',
    '[Bluehole Studio] 시니어 VFX 아티스트 - TERA2',
    '[NC-퍼스트스파크게임즈][TL] 3D 캐릭터 아티스트 모집',
    '[모카트리] 모바일 UI/UX 디자이너를 모십니다.',
    '[PUBG STUDIOS] Mobile Game GUI 디자이너 / 그래픽 디자이너 - Project UROPA (계약직)',
    'SBS아카데미 게임학원 수원 교육부 원화 강사채용',
    '[강남지점] 아트웍, 인스타툰 주말 강사 모집',
    '[프로젝트 BB] 배경 컨셉 아티스트',
    // 캐릭터 공고라도 제외어는 적용한다(리뷰 지적).
    '3D 캐릭터 원화/모델링',
    '캐릭터 UI 컨셉',
    '캐릭터 애니메이션 원화',
  ])('excludes %s', (title) => {
    expect(isTargetArtRole(title)).toBe(false);
  });
});
