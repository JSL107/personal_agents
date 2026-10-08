import { readdirSync, readFileSync } from 'fs';
import { join, sep } from 'path';

import { ReplayRejectionCode } from '../../run-replay/domain/run-replay.type';
import { ResponseCode } from './response-code.enum';

// AllExceptionsFilter 는 도메인 errorCode 를 ResponseCode 값으로 찾는다 — 없으면 INTERNAL_SERVER_ERROR 로
// 떨어져 클라이언트가 거절과 서버 오류를 구분하지 못한다.
// src/**/*error-code.enum.ts 를 자동으로 모으므로 새 도메인 enum 도 파일명 규칙만 지키면 검사된다.
const SOURCE_ROOT = join(__dirname, '../..');

// 도메인과 무관한 공통 코드 — 도메인 enum 에 같은 값이 있으면 거절이 서버 오류로 보인다.
const COMMON_CODES: ReadonlySet<string> = new Set([
  ResponseCode.SUCCESS,
  ResponseCode.INTERNAL_SERVER_ERROR,
  ResponseCode.VALIDATION_FAILED,
]);

// 여러 도메인이 일부러 같이 쓰는 값. 도메인 값이 agent_run.errorCode 로 저장돼 이름을 나누지 않았다.
const SHARED_CODES: ReadonlySet<string> = new Set([ResponseCode.PARSE_FAILED]);

// DomainException 을 던지지만 errorCode enum 이 파일명 규칙 밖에 있는 파일 — enum 은 아래에 손으로 올린다.
const EXCEPTIONS_OUTSIDE_NAMING: ReadonlySet<string> = new Set([
  'run-replay/domain/run-replay.exception.ts',
]);

const sourceFiles = readdirSync(SOURCE_ROOT, {
  recursive: true,
  encoding: 'utf8',
})
  .map((file) => file.split(sep).join('/'))
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'));

const domainErrorCodes: [string, Record<string, string>][] = [
  ...sourceFiles
    .filter((file) => file.endsWith('error-code.enum.ts'))
    .flatMap((file) =>
      Object.entries(
        jest.requireActual<Record<string, Record<string, string>>>(
          join(SOURCE_ROOT, file),
        ),
      ),
    ),
  ['ReplayRejectionCode', ReplayRejectionCode],
];

const domainValues = domainErrorCodes.flatMap(([, domainErrorCode]) =>
  Object.values(domainErrorCode),
);

describe('ResponseCode', () => {
  const responseCodes = new Set<string>(Object.values(ResponseCode));

  it('DomainException 을 던지는 파일은 전부 errorCode enum 이 수집 대상이다', () => {
    const uncovered = sourceFiles.filter((file) => {
      const source = readFileSync(join(SOURCE_ROOT, file), 'utf8');
      return (
        /extends DomainException\b/.test(source) &&
        !/error-code\.enum'/.test(source) &&
        !EXCEPTIONS_OUTSIDE_NAMING.has(file)
      );
    });
    expect(uncovered).toEqual([]);
  });

  it.each(domainErrorCodes)(
    '%s 전부가 ResponseCode 에 있다',
    (_, domainErrorCode) => {
      for (const code of Object.values(domainErrorCode)) {
        expect(responseCodes).toContain(code);
      }
    },
  );

  it('도메인 값은 다른 도메인·공통 코드와 겹치지 않는다', () => {
    const duplicated = domainValues.filter(
      (code, index) =>
        !SHARED_CODES.has(code) && domainValues.indexOf(code) !== index,
    );
    expect(duplicated).toEqual([]);
    expect(domainValues.filter((code) => COMMON_CODES.has(code))).toEqual([]);
  });

  it('ResponseCode 에는 어느 도메인에도 없는 값이 남아 있지 않다', () => {
    const known = new Set([...domainValues, ...COMMON_CODES]);
    expect([...responseCodes].filter((code) => !known.has(code))).toEqual([]);
  });
});
