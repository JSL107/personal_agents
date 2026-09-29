import { TreeSitterParser } from './tree-sitter-parser';

describe('TreeSitterParser', () => {
  let parser: TreeSitterParser;

  beforeEach(() => {
    parser = new TreeSitterParser();
  });

  it('class + method 를 별도 chunk 로 추출한다', () => {
    const chunks = parser.parseFile({
      filePath: 'foo.ts',
      source: `class Foo {\n  bar() {}\n}`,
    });
    const klass = chunks.find((c) => c.kind === 'class');
    const method = chunks.find((c) => c.kind === 'method');
    expect(klass?.name).toBe('Foo');
    expect(method?.name).toBe('bar');
  });

  it('top-level function declaration 을 추출한다', () => {
    const chunks = parser.parseFile({
      filePath: 'foo.ts',
      source: `function add(a: number, b: number): number { return a + b; }`,
    });
    const fn = chunks.find((c) => c.kind === 'function');
    expect(fn?.name).toBe('add');
  });

  it('interface declaration 을 추출한다', () => {
    const chunks = parser.parseFile({
      filePath: 'foo.ts',
      source: `interface User { id: string; name: string; }`,
    });
    const iface = chunks.find((c) => c.kind === 'interface');
    expect(iface?.name).toBe('User');
  });

  it('type alias 를 추출한다', () => {
    const chunks = parser.parseFile({
      filePath: 'foo.ts',
      source: `type UserId = string;`,
    });
    const alias = chunks.find((c) => c.kind === 'type-alias');
    expect(alias?.name).toBe('UserId');
  });

  it('startLine 은 1-indexed', () => {
    const chunks = parser.parseFile({
      filePath: 'foo.ts',
      source: `\n\nclass Foo {}`, // 3번째 줄에 class
    });
    const klass = chunks.find((c) => c.kind === 'class');
    expect(klass?.startLine).toBe(3);
  });

  it('generic class + 데코레이터 + async method 를 모두 추출한다', () => {
    const chunks = parser.parseFile({
      filePath: 'service.ts',
      source: `
@Injectable()
class Repository<T extends { id: string }> {
  async findById(id: string): Promise<T | null> {
    return null;
  }
}`,
    });
    expect(chunks.find((c) => c.kind === 'class')?.name).toBe('Repository');
    expect(chunks.find((c) => c.kind === 'method')?.name).toBe('findById');
  });

  it('화살표 함수·함수 표현식 상수를 function chunk 로 추출한다', () => {
    const chunks = parser.parseFile({
      filePath: 'foo.ts',
      source: [
        'export const buildArgs = (model: string): string[] => [',
        "  '-p',",
        '  model,',
        '];',
        'const legacy = function () { return 1; };',
        'const LIMIT = 3;',
      ].join('\n'),
    });
    const functions = chunks.filter((c) => c.kind === 'function');
    expect(functions.map((c) => c.name)).toEqual(['buildArgs', 'legacy']);
    expect(functions[0]).toMatchObject({ startLine: 1, endLine: 4 });
    expect(functions[0].source).toContain("'-p'");
    expect(chunks.find((c) => c.name === 'LIMIT')).toBeUndefined();
  });

  it('여러 chunk 가 한 파일에서 추출된다', () => {
    const chunks = parser.parseFile({
      filePath: 'multi.ts',
      source: `
interface Config { url: string; }
type Status = 'ok' | 'error';
class Service {
  start() {}
  stop() {}
}
function helper() {}`,
    });
    const kinds = chunks.map((c) => c.kind).sort();
    expect(kinds).toContain('interface');
    expect(kinds).toContain('type-alias');
    expect(kinds).toContain('class');
    expect(kinds.filter((k) => k === 'method')).toHaveLength(2);
    expect(kinds).toContain('function');
  });
});
