import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { HUMANIZE_RULE_LINKS } from '../src/humanize/domain/humanize-rule-links';
import {
  compareLinks,
  extractQuickRuleRow,
  LinkCheckResult,
  normalizeSnapshot,
} from '../src/humanize/domain/humanize-rule-links.check';

type Options = { repository: string; accept: boolean };
type PythonSnapshots = Record<string, string | null>;

const PYTHON_DUMP = `import importlib, inspect, json, re, sys
sys.path.insert(0, sys.argv[1])
module = importlib.import_module("metrics_v2")
result = {}
for name in json.loads(sys.argv[2]):
    if not hasattr(module, name):
        result[name] = None
        continue
    value = getattr(module, name)
    if isinstance(value, (tuple, list)):
        result[name] = json.dumps(value, ensure_ascii=False)
    elif isinstance(value, re.Pattern):
        result[name] = value.pattern
    elif inspect.isfunction(value):
        result[name] = inspect.getsource(value)
    else:
        raise TypeError("Unsupported python symbol: " + name)
print(json.dumps(result, ensure_ascii=False))`;

const parseOptions = (argumentsList: string[]): Options => {
  let repository = join(homedir(), '.claude/skills/humanize-korean');
  let accept = false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--accept') {
      accept = true;
    } else if (argument === '--repo' && argumentsList[index + 1]) {
      repository = resolve(argumentsList[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  return { repository, accept };
};

const loadPythonSnapshots = (references: string): PythonSnapshots => {
  const symbols = HUMANIZE_RULE_LINKS.flatMap((link) =>
    link.upstream?.kind === 'python-symbol' ? [link.upstream.symbol] : [],
  );
  const output = execFileSync(
    'python3',
    ['-I', '-c', PYTHON_DUMP, references, JSON.stringify(symbols)],
    {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  return JSON.parse(output) as PythonSnapshots;
};

const loadCurrent = (repository: string): Map<string, string | null> => {
  const references = join(repository, 'references');
  const markdown = readFileSync(join(references, 'quick-rules.md'), 'utf8');
  const pythonSnapshots = loadPythonSnapshots(references);
  const current = new Map<string, string | null>();
  for (const link of HUMANIZE_RULE_LINKS) {
    if (link.upstream?.kind === 'quick-rule') {
      current.set(link.id, extractQuickRuleRow(markdown, link.upstream.ruleId));
    } else if (link.upstream?.kind === 'python-symbol') {
      current.set(link.id, pythonSnapshots[link.upstream.symbol] ?? null);
    }
  }
  return current;
};

const acceptSnapshots = (results: LinkCheckResult[]): void => {
  const file = resolve(
    __dirname,
    '../src/humanize/domain/humanize-rule-links.ts',
  );
  let source = readFileSync(file, 'utf8');
  for (const result of results) {
    if (result.status !== 'changed') {
      continue;
    }
    source = replaceSnapshot(source, result);
  }
  if (results.some((result) => result.status === 'changed')) {
    writeFileSync(file, source);
    // 스냅샷은 JSON.stringify 한 줄로 들어가 레포 서식과 어긋난다 — 그대로 두면 lint:check 가 끊긴다.
    execFileSync(
      resolve(__dirname, '../node_modules/.bin/prettier'),
      ['--write', file],
      { stdio: 'ignore' },
    );
  }
};

const replaceSnapshot = (
  source: string,
  result: Extract<LinkCheckResult, { status: 'changed' }>,
): string => {
  const link = HUMANIZE_RULE_LINKS.find(
    (candidate) => candidate.id === result.id,
  );
  if (!link) {
    throw new Error(`Unknown link: ${result.id}`);
  }
  const marker = `id: '${result.id}',`;
  const start = source.indexOf(marker);
  if (start < 0 || source.indexOf(marker, start + marker.length) >= 0) {
    throw new Error(`Expected one link declaration: ${result.id}`);
  }
  const end = source.indexOf('\n  {', start + marker.length);
  const sectionEnd = end < 0 ? source.length : end;
  const section = source.slice(start, sectionEnd);
  const literals = [
    ...section.matchAll(
      /upstreamSnapshot:\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g,
    ),
  ];
  if (
    literals.length !== 1 ||
    !link.upstreamSnapshot ||
    normalizeSnapshot(link.upstreamSnapshot) !== result.before
  ) {
    throw new Error(`Expected one matching snapshot literal: ${result.id}`);
  }
  const literal = literals[0];
  const replacement = `upstreamSnapshot: ${JSON.stringify(result.after)}`;
  const updatedSection =
    section.slice(0, literal.index) +
    replacement +
    section.slice(literal.index + literal[0].length);
  return source.slice(0, start) + updatedSection + source.slice(sectionEnd);
};

const printResults = (results: LinkCheckResult[]): void => {
  for (const result of results) {
    console.log(`${result.id}: ${result.status}`);
    if (result.status === 'changed') {
      console.log(`  before:\n${result.before}\n  after:\n${result.after}`);
    }
  }
};

const main = (): void => {
  try {
    const options = parseOptions(process.argv.slice(2));
    const current = loadCurrent(options.repository);
    const results = compareLinks(HUMANIZE_RULE_LINKS, current);
    printResults(results);
    if (options.accept) {
      acceptSnapshots(results);
    }
    if (
      results.some(
        (result) =>
          result.status === 'missing' ||
          (result.status === 'changed' && !options.accept),
      )
    ) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      `humanize rule link check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 2;
  }
};

main();
