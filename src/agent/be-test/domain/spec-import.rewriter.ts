import { posix } from 'node:path';

export interface RewriteSpecImportsInput {
  specCode: string;
  targetDirInContainer: string;
}

const MODULE_SPECIFIER_PATTERN =
  /(\bfrom\s+|\brequire\s*\(\s*|\bjest\.mock\s*\(\s*)(['"])([^'"]+)\2/g;

const STATIC_IMPORT_PATTERN = /^\s*import\b/;
const RE_EXPORT_PATTERN = /^\s*export\b/;
const MULTILINE_IMPORT_FROM_PATTERN = /^\s*\}\s*from\b/;
const JEST_MOCK_PATTERN = /^\s*jest\.mock\s*\(/;
const REQUIRE_CALL_PATTERN = /require\s*\(/;
const REQUIRE_DECLARATION_PATTERN = /^\s*(?:const|let|var|import)\b/;
const REQUIRE_ASSIGNMENT_PATTERN = /=\s*require\s*\(/;
const BARE_REQUIRE_PATTERN = /^\s*require\s*\(/;

const isRewritableModuleLine = (line: string): boolean =>
  STATIC_IMPORT_PATTERN.test(line) ||
  RE_EXPORT_PATTERN.test(line) ||
  MULTILINE_IMPORT_FROM_PATTERN.test(line) ||
  JEST_MOCK_PATTERN.test(line) ||
  (REQUIRE_CALL_PATTERN.test(line) &&
    ((REQUIRE_DECLARATION_PATTERN.test(line) &&
      REQUIRE_ASSIGNMENT_PATTERN.test(line)) ||
      BARE_REQUIRE_PATTERN.test(line)));

// ponytail: 줄 시작 유형으로 재작성 대상을 제한해 객체 속성 안의 `require('./x')` 같은 형태는 처리하지 않는다. 해당 형태까지 필요해지면 TreeSitterTestAnalyzer 로 import 노드만 재작성하도록 올린다.
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

      if (!isRewritableModuleLine(line)) {
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
