import { crawlerParser } from './crawler.parser';

describe('crawlerParser', () => {
  const TARGET_URL = 'https://example.com';

  describe('title 추출', () => {
    it('HTML에서 title을 추출한다', () => {
      // Given
      const html = '<html><head><title>Test Page</title></head><body></body></html>';

      // When
      const result = crawlerParser(html, TARGET_URL);

      // Then
      expect(result.title).toBe('Test Page');
    });

    it('title 태그가 없으면 빈 문자열을 반환한다', () => {
      // Given
      const html = '<html><head></head><body></body></html>';

      // When
      const result = crawlerParser(html, TARGET_URL);

      // Then
      expect(result.title).toBe('');
    });
  });

  describe('description 추출', () => {
    it('meta description 태그에서 내용을 추출한다', () => {
      // Given
      const html =
        '<html><head><meta name="description" content="페이지 설명입니다."></head></html>';

      // When
      const result = crawlerParser(html, TARGET_URL);

      // Then
      expect(result.description).toBe('페이지 설명입니다.');
    });

    it('meta description 태그가 없으면 빈 문자열을 반환한다', () => {
      // Given
      const html = '<html><head></head><body></body></html>';

      // When
      const result = crawlerParser(html, TARGET_URL);

      // Then
      expect(result.description).toBe('');
    });
  });

  describe('스냅샷', () => {
    it('title + description 전체 구조가 스냅샷과 일치한다', () => {
      // Given
      const html = `
        <html>
          <head>
            <title>크롤링 테스트 페이지</title>
            <meta name="description" content="스냅샷 검증용 설명입니다.">
          </head>
          <body><p>본문</p></body>
        </html>
      `;

      // When
      const result = crawlerParser(html, TARGET_URL);

      // Then — 최초 실행 시 __snapshots__/crawler.parser.spec.ts.snap 파일이 생성되고,
      // 이후 파서 로직 변경 시 스냅샷 불일치로 회귀를 감지한다.
      expect(result).toMatchSnapshot();
    });

    it('빈 HTML 파싱 결과가 스냅샷과 일치한다', () => {
      // Given
      const html = '<html><head></head><body></body></html>';

      // When
      const result = crawlerParser(html, TARGET_URL);

      // Then
      expect(result).toMatchSnapshot();
    });
  });
});
