import { CodeRelation } from '../domain/code-relation.type';
import { TreeSitterRelationExtractor } from './tree-sitter-relation-extractor';

describe('TreeSitterRelationExtractor', () => {
  let extractor: TreeSitterRelationExtractor;

  beforeEach(() => {
    extractor = new TreeSitterRelationExtractor();
  });

  const findRelation = (
    relations: CodeRelation[],
    predicate: (r: CodeRelation) => boolean,
  ): CodeRelation | undefined => relations.find(predicate);

  it('named import 의 from / to / symbols 를 추출한다', () => {
    const relations = extractor.extractRelations({
      filePath: 'a.ts',
      source: `import { A, B } from './foo';`,
    });
    const rel = findRelation(relations, (r) => r.kind === 'imports');
    expect(rel).toEqual({
      kind: 'imports',
      from: 'a.ts',
      to: './foo',
      symbols: ['A', 'B'],
    });
  });

  it('default import 의 식별자를 symbols 에 포함', () => {
    const relations = extractor.extractRelations({
      filePath: 'a.ts',
      source: `import Foo from './bar';`,
    });
    const rel = findRelation(relations, (r) => r.kind === 'imports');
    expect(rel?.kind).toBe('imports');
    if (rel?.kind === 'imports') {
      expect(rel.symbols).toContain('Foo');
      expect(rel.to).toBe('./bar');
    }
  });

  it('namespace import 의 별칭을 symbols 에 포함', () => {
    const relations = extractor.extractRelations({
      filePath: 'a.ts',
      source: `import * as ns from 'pkg';`,
    });
    const rel = findRelation(relations, (r) => r.kind === 'imports');
    if (rel?.kind === 'imports') {
      expect(rel.symbols).toContain('ns');
      expect(rel.to).toBe('pkg');
    }
  });

  it('class extends 관계를 추출한다', () => {
    const relations = extractor.extractRelations({
      filePath: 'a.ts',
      source: `class Child extends Base {}`,
    });
    expect(relations).toContainEqual({
      kind: 'extends',
      from: 'Child',
      to: 'Base',
    });
  });

  it('class implements 관계 다중 인터페이스 추출', () => {
    const relations = extractor.extractRelations({
      filePath: 'a.ts',
      source: `class Foo implements PortA, PortB {}`,
    });
    expect(relations).toContainEqual({
      kind: 'implements',
      from: 'Foo',
      to: 'PortA',
    });
    expect(relations).toContainEqual({
      kind: 'implements',
      from: 'Foo',
      to: 'PortB',
    });
  });

  it('interface extends 관계 추출', () => {
    const relations = extractor.extractRelations({
      filePath: 'a.ts',
      source: `interface SubPort extends BasePort {}`,
    });
    expect(relations).toContainEqual({
      kind: 'extends',
      from: 'SubPort',
      to: 'BasePort',
    });
  });

  it('이대리 Port-Adapter 컨벤션 (Symbol Port + implements) 을 일반 implements 로 인식', () => {
    const relations = extractor.extractRelations({
      filePath: 'foo.adapter.ts',
      source: `
export const FOO_PORT = Symbol('FOO_PORT');

export interface FooPort {
  doFoo(): void;
}

export class FooAdapter implements FooPort {
  doFoo() {}
}`,
    });
    // 단계 4 query 에서 'FooPort' 로 findImplementersOf 시 FooAdapter 가 잡혀야 함.
    expect(relations).toContainEqual({
      kind: 'implements',
      from: 'FooAdapter',
      to: 'FooPort',
    });
  });

  it('함수 호출의 to + callSite.line 을 추출한다', () => {
    const relations = extractor.extractRelations({
      filePath: 'a.ts',
      source: `\nfunction outer() {\n  innerFn();\n}`,
    });
    const callRel = findRelation(
      relations,
      (r) => r.kind === 'calls' && r.to === 'innerFn',
    );
    expect(callRel?.kind).toBe('calls');
    if (callRel?.kind === 'calls') {
      expect(callRel.callSite.line).toBe(3);
    }
  });

  it('member 호출 (obj.method) 의 to 가 텍스트 그대로 보존', () => {
    const relations = extractor.extractRelations({
      filePath: 'a.ts',
      source: `obj.method();`,
    });
    expect(relations).toContainEqual(
      expect.objectContaining({ kind: 'calls', to: 'obj.method' }),
    );
  });

  it('generic implements (Port<T>) 의 base type 이름을 추출한다', () => {
    // codex review P2 — generic_type 자식 처리. NestJS NestInterceptor<T> 등 흔한 패턴.
    const relations = extractor.extractRelations({
      filePath: 'a.ts',
      source: `class ResponseInterceptor<T> implements NestInterceptor<T> {}`,
    });
    expect(relations).toContainEqual({
      kind: 'implements',
      from: 'ResponseInterceptor',
      to: 'NestInterceptor',
    });
  });

  it('namespaced implements (Ns.Port) 의 전체 식별자를 보존한다', () => {
    const relations = extractor.extractRelations({
      filePath: 'a.ts',
      source: `class Foo implements Namespace.Port {}`,
    });
    expect(relations).toContainEqual({
      kind: 'implements',
      from: 'Foo',
      to: 'Namespace.Port',
    });
  });

  it('한 파일에서 imports + extends + implements + calls 가 모두 누적된다', () => {
    const relations = extractor.extractRelations({
      filePath: 'mix.ts',
      source: `
import { Base } from './base';
import { Port } from './port';

class Service extends Base implements Port {
  start() {
    this.helper();
  }
}`,
    });
    expect(relations.filter((r) => r.kind === 'imports')).toHaveLength(2);
    expect(relations.filter((r) => r.kind === 'extends')).toHaveLength(1);
    expect(relations.filter((r) => r.kind === 'implements')).toHaveLength(1);
    expect(
      relations.filter((r) => r.kind === 'calls').length,
    ).toBeGreaterThanOrEqual(1);
  });
});
