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

  it('arrow function 으로 export 된 const 는 function chunk 로 추출되지 않는다 (현재 한계)', () => {
    // tree-sitter 의 function_declaration 은 명시적 function 키워드만 인식.
    // const foo = () => {} 는 lexical_declaration 이라 추출 X — 단계 2/3 에서 보강 가능 (한계 명시).
    const chunks = parser.parseFile({
      filePath: 'foo.ts',
      source: `export const foo = () => 42;`,
    });
    expect(chunks.find((c) => c.kind === 'function')).toBeUndefined();
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
