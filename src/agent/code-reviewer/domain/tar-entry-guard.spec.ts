import { buildTar, paxRecord } from './__fixtures__/tar-archive';
import { findUnsafeTarEntries, listTarEntryNames } from './tar-entry-guard';

const TOP = 'o-r-abc';

describe('findUnsafeTarEntries', () => {
  it('최상위 디렉터리 아래 일반 파일·디렉터리·안쪽 링크는 통과한다', () => {
    const tar = buildTar({
      entries: [
        { path: `${TOP}/`, type: '5' },
        { path: `${TOP}/src/a.ts`, body: 'export {};' },
        { path: `${TOP}/src/link`, type: '2', linkPath: 'a.ts' },
        { path: `${TOP}/docs/up`, type: '2', linkPath: '../src/a.ts' },
        { path: `${TOP}/hard`, type: '1', linkPath: `${TOP}/src/a.ts` },
      ],
    });

    expect(findUnsafeTarEntries({ tar })).toEqual([]);
  });

  it('`..` 구간이나 절대경로를 가진 항목을 잡는다', () => {
    const tar = buildTar({
      entries: [{ path: `${TOP}/../../evil` }, { path: '/etc/evil' }],
    });

    expect(findUnsafeTarEntries({ tar })).toEqual([
      `경로가 사본 밖을 가리킨다: ${TOP}/../../evil`,
      '경로가 사본 밖을 가리킨다: /etc/evil',
    ]);
  });

  // 링크를 먼저 풀고 그 아래로 파일을 쓰게 하면 사본 밖에 쓴다 — 링크 자체를 거른다.
  it('사본 밖을 가리키는 심볼릭 링크와 하드 링크를 잡는다', () => {
    const tar = buildTar({
      entries: [
        { path: `${TOP}/abs`, type: '2', linkPath: '/Users/x/.ssh' },
        { path: `${TOP}/src/up`, type: '2', linkPath: '../../outside' },
        { path: `${TOP}/hard`, type: '1', linkPath: `${TOP}/../outside` },
      ],
    });

    expect(findUnsafeTarEntries({ tar })).toEqual([
      `링크 대상이 절대경로다: ${TOP}/abs -> /Users/x/.ssh`,
      `링크 대상이 사본 밖이다: ${TOP}/src/up -> ../../outside`,
      `링크 대상이 사본 밖이다: ${TOP}/hard -> ${TOP}/../outside`,
    ]);
  });

  // GitHub tarball 은 긴 경로를 pax 확장 헤더로 싣는다. ustar 이름 칸만 보면 이 우회를 놓친다.
  it('pax 확장 헤더의 path·linkpath 를 다음 항목에 적용한다', () => {
    const tar = buildTar({
      entries: [
        {
          path: 'PaxHeader',
          type: 'x',
          body: paxRecord({ key: 'path', value: `${TOP}/../evil` }),
        },
        { path: `${TOP}/harmless-looking` },
        {
          path: 'PaxHeader',
          type: 'x',
          body: paxRecord({ key: 'linkpath', value: '/etc' }),
        },
        { path: `${TOP}/link`, type: '2', linkPath: 'ok' },
        { path: `${TOP}/after` },
      ],
    });

    expect(findUnsafeTarEntries({ tar })).toEqual([
      `경로가 사본 밖을 가리킨다: ${TOP}/../evil`,
      `링크 대상이 절대경로다: ${TOP}/link -> /etc`,
    ]);
  });

  it('pax 전역 헤더(GitHub 의 커밋 주석)는 건너뛴다', () => {
    const tar = buildTar({
      entries: [
        {
          path: 'pax_global_header',
          type: 'g',
          body: paxRecord({ key: 'comment', value: 'abc123' }),
        },
        { path: `${TOP}/a.txt`, body: 'x' },
      ],
    });

    expect(findUnsafeTarEntries({ tar })).toEqual([]);
  });

  it('헤더 크기 칸을 읽지 못하면 사유로 낸다', () => {
    const tar = buildTar({ entries: [{ path: `${TOP}/a.txt` }] });
    tar.write('zzzzzzzzzzz\0', 124, 'ascii');

    expect(findUnsafeTarEntries({ tar })).toEqual([
      'tar 헤더를 읽지 못했다 (offset 0)',
    ]);
  });

  // pax 레코드는 길이로 끊는다 — 값 안의 줄바꿈에서 자르면 이름이 짧아져 검사를 비껴간다.
  it('pax path 값에 줄바꿈이 있어도 이름 전체를 읽는다', () => {
    const tar = buildTar({
      entries: [
        {
          path: 'PaxHeader',
          type: 'x',
          body: paxRecord({ key: 'path', value: `${TOP}/a\nb/.env` }),
        },
        { path: 'placeholder', body: 'SECRET=1' },
      ],
    });

    expect(listTarEntryNames({ tar })).toEqual([`${TOP}/a\nb/.env`]);
  });

  it('pax path 값의 줄바꿈 뒤에 숨긴 `..` 도 잡는다', () => {
    const tar = buildTar({
      entries: [
        {
          path: 'PaxHeader',
          type: 'x',
          body: paxRecord({ key: 'path', value: `${TOP}/a\n/../../evil` }),
        },
        { path: 'placeholder', body: 'x' },
      ],
    });

    expect(findUnsafeTarEntries({ tar })).toHaveLength(1);
  });
});
