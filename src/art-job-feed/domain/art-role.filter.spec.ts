import { isTargetArtRole } from './art-role.filter';

describe('isTargetArtRole', () => {
  it.each([
    '[카오스 제로 나이트메어] 캐릭터 원화',
    '[LOST ARK Mobile] 캐릭터컨셉(원화) 담당',
    '[외주/프리랜서] 캐릭터 의상 원화 디자이너 모집 - 서브컬쳐 애니메 그림체',
    '[프로젝트 A] 캐릭터 원화, 일러스트 제작',
  ])('includes %s', (title) => {
    expect(isTargetArtRole(title)).toBe(true);
  });
  it.each([
    '[마비노기 모바일] 3D 캐릭터 모델러 모집',
    '[Project EA] 리드 애니메이터',
    '[LOST ARK Mobile] 배경원화(컨셉) 담당',
    '[넷마블네오] 블룸워커 캐릭터모델링 담당 모집',
    '[Bluehole Studio] 시니어 VFX 아티스트 - TERA2',
  ])('excludes %s', (title) => {
    expect(isTargetArtRole(title)).toBe(false);
  });
});
