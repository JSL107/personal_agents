import { posix } from 'node:path';

export interface RewriteSpecImportsInput {
  specCode: string;
  targetDirInContainer: string;
}

const MODULE_SPECIFIER_PATTERN =
  /(\bfrom\s+|\brequire\s*\(\s*|\bjest\.mock\s*\(\s*)(['"])([^'"]+)\2/g;

export const rewriteSpecImportsForSandbox = (
  input: RewriteSpecImportsInput,
): string =>
  input.specCode.replace(
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
