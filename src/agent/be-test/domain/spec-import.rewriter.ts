import { posix } from 'node:path';

export interface RewriteSpecImportsInput {
  specCode: string;
  targetDirInContainer: string;
}

const MODULE_SPECIFIER_PATTERN =
  /(\bfrom\s+|\brequire\s*\(\s*|\bjest\.mock\s*\(\s*)(['"])([^'"]+)\2/g;

// ponytail: 정규식 기반이라 문자열 리터럴 안의 import 형태까지 치환될 수 있다. 구문 단위 판별이 필요해지면 TreeSitterTestAnalyzer 로 import 노드만 재작성하도록 올린다.
export const rewriteSpecImportsForSandbox = (
  input: RewriteSpecImportsInput,
): string =>
  input.specCode
    .split('\n')
    .map((line) => {
      const trimmedLine = line.trimStart();
      if (
        trimmedLine.startsWith('//') ||
        trimmedLine.startsWith('*') ||
        trimmedLine.startsWith('/*')
      ) {
        return line;
      }

      return line.replace(
        MODULE_SPECIFIER_PATTERN,
        (match, prefix: string, quote: string, specifier: string) => {
          if (!specifier.startsWith('.')) {
            return match;
          }

          const resolvedSpecifier = posix.resolve(
            input.targetDirInContainer,
            specifier,
          );
          return `${prefix}${quote}${resolvedSpecifier}${quote}`;
        },
      );
    })
    .join('\n');
