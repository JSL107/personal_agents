import { parseStudyDiagram } from './study-diagram.parser';

const svgDocument = [
  '<!doctype html>',
  '<html><body style="margin:0">',
  '<svg viewBox="0 0 700 900" width="700" height="900">',
  '<text x="20" y="40" font-size="20">요청</text>',
  '</svg>',
  '</body></html>',
].join('\n');

describe('parseStudyDiagram', () => {
  it('html 코드펜스 안의 문서를 꺼낸다', () => {
    const result = parseStudyDiagram(
      '아래와 같이 그렸습니다.\n\n```html\n' + svgDocument + '\n```\n',
    );

    expect(result).toEqual({ html: svgDocument });
  });

  it('언어 표시가 없는 코드펜스도 받는다', () => {
    const result = parseStudyDiagram('```\n' + svgDocument + '\n```');

    expect(result).toEqual({ html: svgDocument });
  });

  it('진행 로그가 앞에 붙어도 코드펜스만 골라낸다', () => {
    const result = parseStudyDiagram(
      '[progress] drawing\n[progress] done\n```html\n' + svgDocument + '\n```',
    );

    expect(result).toEqual({ html: svgDocument });
  });

  it('코드펜스가 여러 개면 그림 문서인 쪽을 고른다', () => {
    const raw = [
      '설명 먼저 드리면,',
      '```text',
      '이 그림은 요청과 응답의 흐름을 나타냅니다.',
      '```',
      '실제 그림입니다.',
      '```html',
      svgDocument,
      '```',
    ].join('\n');

    expect(parseStudyDiagram(raw)).toEqual({ html: svgDocument });
  });

  // ko-ending-gate:allow
  it('그림 뒤에 설명 펜스가 와도 그림을 고른다 — 위치가 아니라 내용으로 판별한다', () => {
    const raw = [
      '그림입니다.',
      '```html',
      svgDocument,
      '```',
      '덧붙이면,',
      '```text',
      '위 그림은 요청과 응답의 흐름을 보여줍니다.',
      '```',
    ].join('\n');

    expect(parseStudyDiagram(raw)).toEqual({ html: svgDocument });
  });

  it('코드펜스가 없으면 거부한다', () => {
    const result = parseStudyDiagram('그림을 그리지 못했습니다.');

    expect(result).toMatchObject({
      rejectedReason: expect.stringContaining('코드펜스'),
    });
  });

  it('펜스는 있지만 svg 도 html 도 없으면 거부한다', () => {
    const result = parseStudyDiagram('```html\n<p>설명만 있습니다</p>\n```');

    expect(result).toMatchObject({
      rejectedReason: expect.stringContaining('그림'),
    });
  });

  it.each([
    ['<img src="https://cdn.example/a.png">', 'https'],
    ['<script src="//cdn.example/b.js"></script>', '//'],
    ['<link rel="stylesheet" href="http://cdn.example/c.css">', 'http'],
  ])('외부 리소스(%s)를 참조하면 거부한다', (tag) => {
    const raw = '```html\n<html><body>' + tag + '<svg><text font-size="20">가</text></svg></body></html>\n```';

    const result = parseStudyDiagram(raw);

    expect(result).toMatchObject({
      rejectedReason: expect.stringContaining('외부'),
    });
  });

  it('data URI 는 외부 리소스로 보지 않는다', () => {
    const raw =
      '```html\n<html><body><img src="data:image/png;base64,iVBOR">' +
      '<svg><text font-size="20">가</text></svg></body></html>\n```';

    expect(parseStudyDiagram(raw)).toMatchObject({
      html: expect.stringContaining('data:image/png'),
    });
  });

  it('빈 문자열을 거부한다', () => {
    expect(parseStudyDiagram('   ')).toMatchObject({
      rejectedReason: expect.any(String),
    });
  });
});
