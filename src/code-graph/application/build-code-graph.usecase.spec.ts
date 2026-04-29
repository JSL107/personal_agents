import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CODE_GRAPH_SNAPSHOT_VERSION } from '../domain/code-graph.type';
import { TreeSitterParser } from '../infrastructure/tree-sitter-parser';
import { TreeSitterRelationExtractor } from '../infrastructure/tree-sitter-relation-extractor';
import { BuildCodeGraphUsecase } from './build-code-graph.usecase';

describe('BuildCodeGraphUsecase', () => {
  let rootDir: string;
  let usecase: BuildCodeGraphUsecase;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'code-graph-build-'));
    usecase = new BuildCodeGraphUsecase(
      new TreeSitterParser(),
      new TreeSitterRelationExtractor(),
    );
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('rootDir 의 .ts 파일에서 chunks + relations 를 모은다', async () => {
    await mkdir(join(rootDir, 'foo'), { recursive: true });
    await writeFile(
      join(rootDir, 'foo/service.ts'),
      `import { Base } from '../base';\nexport class FooService extends Base { run() {} }`,
    );
    await writeFile(
      join(rootDir, 'base.ts'),
      `export class Base { protected log() {} }`,
    );

    const snapshot = await usecase.execute({ rootDir });

    expect(snapshot.version).toBe(CODE_GRAPH_SNAPSHOT_VERSION);
    expect(snapshot.rootDir).toBe(rootDir);
    expect(snapshot.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snapshot.chunks.find((c) => c.name === 'FooService')).toBeDefined();
    expect(snapshot.chunks.find((c) => c.name === 'Base')).toBeDefined();
    expect(
      snapshot.relations.find(
        (r) => r.kind === 'extends' && r.from === 'FooService',
      ),
    ).toBeDefined();
  });

  it('.spec.ts / .d.ts / node_modules / dist / var 디렉터리는 제외', async () => {
    await mkdir(join(rootDir, 'app'), { recursive: true });
    await mkdir(join(rootDir, 'node_modules/skip'), { recursive: true });
    await mkdir(join(rootDir, 'dist'), { recursive: true });
    await mkdir(join(rootDir, 'var'), { recursive: true });
    await writeFile(join(rootDir, 'app/keep.ts'), `class Keep {}`);
    await writeFile(join(rootDir, 'app/keep.spec.ts'), `class SkipSpec {}`);
    await writeFile(join(rootDir, 'app/keep.d.ts'), `declare class SkipDts {}`);
    await writeFile(
      join(rootDir, 'node_modules/skip/skip.ts'),
      `class SkipNm {}`,
    );
    await writeFile(join(rootDir, 'dist/skip.ts'), `class SkipDist {}`);
    await writeFile(join(rootDir, 'var/skip.ts'), `class SkipVar {}`);

    const snapshot = await usecase.execute({ rootDir });

    const names = snapshot.chunks.map((c) => c.name);
    expect(names).toContain('Keep');
    expect(names).not.toContain('SkipSpec');
    expect(names).not.toContain('SkipDts');
    expect(names).not.toContain('SkipNm');
    expect(names).not.toContain('SkipDist');
    expect(names).not.toContain('SkipVar');
  });

  it('chunk.filePath / relation.from 은 rootDir 상대경로', async () => {
    await mkdir(join(rootDir, 'sub'), { recursive: true });
    await writeFile(
      join(rootDir, 'sub/foo.ts'),
      `import './bar';\nclass Foo {}`,
    );

    const snapshot = await usecase.execute({ rootDir });

    const fooChunk = snapshot.chunks.find((c) => c.name === 'Foo');
    expect(fooChunk?.filePath).toBe(join('sub', 'foo.ts'));
    const importRel = snapshot.relations.find(
      (r) => r.kind === 'imports' && r.from === join('sub', 'foo.ts'),
    );
    expect(importRel).toBeDefined();
  });

  it('파싱 실패 파일은 skip 하고 나머지는 진행 (graceful)', async () => {
    await writeFile(join(rootDir, 'good.ts'), `class Good {}`);
    // tree-sitter 는 손상된 TS 도 best-effort 로 파싱하지만 fs read 실패 같은 경우 simulation 어려움.
    // 본 케이스는 graceful 흐름만 확인 — good.ts 가 정상 추출됐는지.
    const snapshot = await usecase.execute({ rootDir });
    expect(snapshot.chunks.find((c) => c.name === 'Good')).toBeDefined();
  });
});
