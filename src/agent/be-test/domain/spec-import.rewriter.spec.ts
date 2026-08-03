import { rewriteSpecImportsForSandbox } from './spec-import.rewriter';

describe('rewriteSpecImportsForSandbox', () => {
  const targetDirInContainer = '/repo/src/agent/be-test/domain';

  it('같은 디렉터리 상대 import 를 sandbox 절대경로로 재작성한다', () => {
    const specCode = "import { value } from './x';";

    expect(
      rewriteSpecImportsForSandbox({ specCode, targetDirInContainer }),
    ).toBe("import { value } from '/repo/src/agent/be-test/domain/x';");
  });

  it('상위 디렉터리 상대 require 경로를 정규화한다', () => {
    const specCode = "const value = require('../y/z');";

    expect(
      rewriteSpecImportsForSandbox({ specCode, targetDirInContainer }),
    ).toBe("const value = require('/repo/src/agent/be-test/y/z');");
  });

  it('패키지와 node: 지정자는 변경하지 않는다', () => {
    const specCode = [
      "import { Injectable } from '@nestjs/common';",
      "import { posix } from 'node:path';",
      "const queue = require('bullmq');",
    ].join('\n');

    expect(
      rewriteSpecImportsForSandbox({ specCode, targetDirInContainer }),
    ).toBe(specCode);
  });

  it('jest.mock 상대 경로를 재작성하고 큰따옴표를 보존한다', () => {
    const specCode = 'jest.mock("./x");';

    expect(
      rewriteSpecImportsForSandbox({ specCode, targetDirInContainer }),
    ).toBe('jest.mock("/repo/src/agent/be-test/domain/x");');
  });

  it('상대 경로가 없으면 원본을 그대로 반환한다', () => {
    const specCode = "import { join } from 'node:path';";

    expect(
      rewriteSpecImportsForSandbox({ specCode, targetDirInContainer }),
    ).toBe(specCode);
  });
});
