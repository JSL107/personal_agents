import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { HUMANIZE_RULE_LINKS } from '../src/humanize/domain/humanize-rule-links';
import {
  compareLinks,
  extractQuickRuleRow,
  hasUnresolvedDrift,
  isPythonSymbolUpstream,
  isQuickRuleUpstream,
} from '../src/humanize/domain/humanize-rule-links.check';
import {
  AcceptSnapshotsParams,
  CheckOptions,
  LinkStatus,
  LoadCurrentParams,
  LoadPythonSnapshotsParams,
  ParseOptionsParams,
  PrintResultsParams,
  PythonSnapshots,
  UpstreamSnapshots,
} from '../src/humanize/domain/humanize-rule-links.type';

const snapshotFile = resolve(
  __dirname,
  '../src/humanize/domain/humanize-rule-links.snapshot.json',
);

const parseOptions = ({ argumentsList }: ParseOptionsParams): CheckOptions => {
  const { values } = parseArgs({
    args: argumentsList,
    options: {
      repo: { type: 'string' },
      accept: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const repository = values.repo
    ? resolve(values.repo)
    : join(homedir(), '.claude/skills/humanize-korean');
  return { repository, accept: values.accept };
};

const loadPythonSnapshots = ({
  references,
}: LoadPythonSnapshotsParams): PythonSnapshots => {
  const symbols = HUMANIZE_RULE_LINKS.map((link) => link.upstream)
    .filter(isPythonSymbolUpstream)
    .map((upstream) => upstream.symbol);
  const output = execFileSync(
    'python3',
    [
      '-I',
      resolve(__dirname, 'dump-metrics-symbols.py'),
      references,
      JSON.stringify(symbols),
    ],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );
  return JSON.parse(output) as PythonSnapshots;
};

const loadCurrent = ({
  repository,
}: LoadCurrentParams): Map<string, string | null> => {
  const references = join(repository, 'references');
  const markdown = readFileSync(join(references, 'quick-rules.md'), 'utf8');
  const pythonSnapshots = loadPythonSnapshots({ references });
  const current = new Map<string, string | null>();
  for (const { id, upstream } of HUMANIZE_RULE_LINKS) {
    if (isQuickRuleUpstream(upstream)) {
      current.set(
        id,
        extractQuickRuleRow({ markdown, ruleId: upstream.ruleId }),
      );
    }
    if (isPythonSymbolUpstream(upstream)) {
      current.set(id, pythonSnapshots[upstream.symbol] ?? null);
    }
  }
  return current;
};

const acceptSnapshots = ({ results }: AcceptSnapshotsParams): void => {
  const changes = new Map(
    results
      .filter((result) => result.status === LinkStatus.CHANGED)
      .map((result) => [result.id, result.after]),
  );
  if (changes.size === 0) {
    return;
  }
  const snapshots = JSON.parse(
    readFileSync(snapshotFile, 'utf8'),
  ) as UpstreamSnapshots;
  const updated = Object.fromEntries(
    HUMANIZE_RULE_LINKS.filter((link) => link.upstream !== null).map((link) => [
      link.id,
      changes.get(link.id) ?? snapshots[link.id],
    ]),
  ) as UpstreamSnapshots;
  writeFileSync(snapshotFile, `${JSON.stringify(updated, null, 2)}\n`);
};

const printResults = ({ results }: PrintResultsParams): void => {
  for (const result of results) {
    console.log(`${result.id}: ${result.status}`);
    if (result.status === LinkStatus.CHANGED) {
      console.log(`  before:\n${result.before}\n  after:\n${result.after}`);
    }
  }
};

const main = (): void => {
  try {
    const options = parseOptions({ argumentsList: process.argv.slice(2) });
    const current = loadCurrent({ repository: options.repository });
    const snapshots = JSON.parse(
      readFileSync(snapshotFile, 'utf8'),
    ) as UpstreamSnapshots;
    const results = compareLinks({
      links: HUMANIZE_RULE_LINKS,
      current,
      snapshots,
    });
    printResults({ results });
    if (options.accept) {
      acceptSnapshots({ results });
    }
    if (hasUnresolvedDrift({ results, accept: options.accept })) {
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
