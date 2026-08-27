import { resolveLocations } from './location';

describe('resolveLocations', () => {
  it('점핏은 첫 토큰이 시도라 그대로 쓴다', () => {
    expect(resolveLocations('jumpit', ['경기 성남시 분당구'])).toEqual([
      '경기',
    ]);
    expect(resolveLocations('jumpit', ['서울 강남구'])).toEqual(['서울']);
  });

  it('원티드는 이미 시도 한글이다', () => {
    expect(resolveLocations('wanted', ['서울'])).toEqual(['서울']);
  });

  it('랠릿은 영문 구역 코드라 대응표로 옮긴다', () => {
    expect(resolveLocations('rallit', ['GANGNAM'])).toEqual(['서울']);
    expect(resolveLocations('rallit', ['GURO_GASAN'])).toEqual(['서울']);
    expect(resolveLocations('rallit', ['PANGYO'])).toEqual(['경기']);
    expect(resolveLocations('rallit', ['GYEONGGI'])).toEqual(['경기']);
  });

  it('대응표에 없는 코드는 지역 없음으로 둔다', () => {
    expect(resolveLocations('rallit', ['ETC'])).toEqual([]);
    expect(resolveLocations('rallit', ['BUSAN_HAEUNDAE'])).toEqual([]);
  });

  it('여러 근무지가 같은 시도면 한 번만 남긴다', () => {
    expect(resolveLocations('rallit', ['GANGNAM', 'MAPO'])).toEqual(['서울']);
  });

  it('빈 입력을 견딘다', () => {
    expect(resolveLocations('jumpit', [])).toEqual([]);
    expect(resolveLocations('jumpit', ['  '])).toEqual([]);
  });
});
