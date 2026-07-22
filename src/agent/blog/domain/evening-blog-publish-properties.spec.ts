import {
  buildEveningBlogProperties,
  toSafeTags,
} from './evening-blog-publish-properties';

describe('evening-blog-publish-properties', () => {
  describe('toSafeTags', () => {
    it('쉼표를 공백으로 바꾸고 trim 한다 (multi_select 옵션명 제약)', () => {
      expect(toSafeTags(['a, b', ' c '])).toEqual(['a  b', 'c']);
    });

    it('빈 문자열/공백-only 는 제거한다', () => {
      expect(toSafeTags(['', '   ', 'keep'])).toEqual(['keep']);
    });

    it('중복을 제거한다', () => {
      expect(toSafeTags(['dup', 'dup', 'x'])).toEqual(['dup', 'x']);
    });

    it('최대 10개로 자른다', () => {
      const many = Array.from({ length: 15 }, (_, i) => `t${i}`);
      expect(toSafeTags(many)).toHaveLength(10);
    });
  });

  describe('buildEveningBlogProperties', () => {
    it('출처유형=PR / 카테고리=개발 회고 / 상태=초안 을 항상 채운다', () => {
      const props = buildEveningBlogProperties([]);
      expect(props).toEqual({
        출처유형: { select: { name: 'PR' } },
        카테고리: { select: { name: '개발 회고' } },
        상태: { select: { name: '초안' } },
      });
    });

    it('키워드가 있으면 태그 multi_select 를 추가한다', () => {
      const props = buildEveningBlogProperties(['nestjs', 'notion']);
      expect(props['태그']).toEqual({
        multi_select: [{ name: 'nestjs' }, { name: 'notion' }],
      });
    });

    it('키워드가 전부 빈값이면 태그 속성을 넣지 않는다', () => {
      const props = buildEveningBlogProperties(['', '  ']);
      expect(props['태그']).toBeUndefined();
    });
  });
});
