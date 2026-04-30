import { Injectable } from '@nestjs/common';

import { PortDependency } from '../domain/be-test.type';

// Port 목록을 받아 Jest mock setup 코드 snippet 을 생성한다.
// 생성된 snippet 은 LLM prompt 에 삽입돼 LLM 이 더 정확한 spec 을 작성하게 돕는다.
@Injectable()
export class JestMockGenerator {
  generateMocks(ports: PortDependency[]): string {
    if (ports.length === 0) {
      return '';
    }

    const lines: string[] = ['// --- Jest Mock Setup (자동 생성) ---'];

    for (const port of ports) {
      lines.push(
        `const mock${capitalize(port.paramName)}: jest.Mocked<${port.typeName}> = {`,
      );
      lines.push(`  // ${port.typeName} 의 메서드를 jest.fn() 으로 stub`);
      lines.push(`} as unknown as jest.Mocked<${port.typeName}>;`);
      lines.push('');
    }

    // constructor arrangement snippet
    lines.push('// SUT 인스턴스 생성 예시:');
    const ctorArgs = ports
      .map((p) => `mock${capitalize(p.paramName)}`)
      .join(', ');
    lines.push(`// const sut = new SUT(${ctorArgs});`);

    return lines.join('\n');
  }
}

const capitalize = (s: string): string =>
  s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
