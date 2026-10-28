import { gzipSync } from 'node:zlib';

// 테스트 전용 ustar 생성기. 시스템 tar 는 플랫폼마다 옵션이 달라(bsdtar `-s`·`@archive` 는 GNU tar 에 없다)
// 사본 밖을 가리키는 항목 같은 비정상 아카이브를 CI(Linux)와 로컬(macOS)에서 똑같이 만들 수 없다.
export interface TarFixtureEntry {
  path: string;
  // '0' 파일, '1' 하드 링크, '2' 심볼릭 링크, '5' 디렉터리, 'x' pax 확장 헤더
  type?: string;
  linkPath?: string;
  body?: string;
}

const BLOCK = 512;

const header = ({
  path,
  type = '0',
  linkPath = '',
  body = '',
}: TarFixtureEntry): Buffer => {
  const block = Buffer.alloc(BLOCK);
  block.write(path, 0, 100, 'utf-8');
  block.write(type === '5' ? '0000755\0' : '0000644\0', 100, 'ascii');
  block.write('0000000\0', 108, 'ascii');
  block.write('0000000\0', 116, 'ascii');
  block.write(
    `${Buffer.byteLength(body).toString(8).padStart(11, '0')}\0`,
    124,
    'ascii',
  );
  block.write('00000000000\0', 136, 'ascii');
  block.write('        ', 148, 'ascii');
  block.write(type, 156, 'ascii');
  block.write(linkPath, 157, 100, 'utf-8');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
  const checksum = block.reduce((sum, byte) => sum + byte, 0);
  block.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return block;
};

const padded = (body: string): Buffer => {
  const raw = Buffer.from(body, 'utf-8');
  return Buffer.concat([
    raw,
    Buffer.alloc((BLOCK - (raw.length % BLOCK)) % BLOCK),
  ]);
};

// pax 레코드 "<len> key=value\n" — len 은 자기 자신을 포함한 바이트 수다.
export const paxRecord = ({
  key,
  value,
}: {
  key: string;
  value: string;
}): string => {
  const rest = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(rest) + 1;
  while (String(length).length + Buffer.byteLength(rest) !== length) {
    length += 1;
  }
  return `${length}${rest}`;
};

export const buildTar = ({
  entries,
}: {
  entries: readonly TarFixtureEntry[];
}): Buffer =>
  Buffer.concat([
    ...entries.flatMap((entry) => [header(entry), padded(entry.body ?? '')]),
    Buffer.alloc(BLOCK * 2),
  ]);

export const buildTarball = ({
  entries,
}: {
  entries: readonly TarFixtureEntry[];
}): Buffer => gzipSync(buildTar({ entries }));
