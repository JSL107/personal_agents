/* 단독 스모크: pnpm exec ts-node --transpile-only scripts/token-analyzer/savings.test.ts
 * 실패 시 비-0 종료. (scripts/ 는 jest rootDir:"src" 밖이라 pnpm test 미커버) */
import { computeSavings, SavingsRecord } from './savings';

let failures = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    failures++;
    console.error(`✗ ${name}\n    got=${g}\n    want=${w}`);
  } else {
    console.log(`✓ ${name}`);
  }
}
function approx(name: string, got: number, want: number): void {
  if (Math.abs(got - want) > 1e-6) {
    failures++;
    console.error(`✗ ${name}\n    got=${got}\n    want=${want}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

// 윈도우: recent = ts>=1000, prev = 0<=ts<1000
const opts = { recentStart: 1000, prevStart: 0, recentStartDay: '2026-06-23' };
const rec = (p: Partial<SavingsRecord>): SavingsRecord => ({
  ts: 0, model: '', project: 'A', input: 0, output: 0,
  costIn: 0, costOut: 0, costRead: 0, costW5: 0, costW1: 0, ...p,
});

const records: SavingsRecord[] = [
  // recent
  rec({ ts: 2000, model: 'claude-opus-4-8', input: 100, output: 200, costOut: 10 }), // opusCost 10, output 10
  rec({ ts: 2000, model: 'claude-sonnet-4-6', costW5: 20, costW1: 10 }),             // cacheWrite 30
  rec({ ts: 2000, model: 'claude-haiku-4-5', costW1: 20 }),                          // cacheWrite 20
  // prev
  rec({ ts: 500, model: 'claude-opus-4-8', output: 40, costOut: 4 }),               // opusCost 4
];

const S = computeSavings(records, opts);

approx('recentCost', S.recentCost, 60);
approx('prevCost', S.prevCost, 4);
approx('delta', S.delta, 56);
approx('deltaPct', S.deltaPct as number, 14); // 56/4
eq('hasPrev', S.hasPrev, true);
eq('topDriver', { kind: S.topDriver!.kind, name: S.topDriver!.name }, { kind: 'type', name: 'cacheWrite' });
approx('topDriver.delta', S.topDriver!.delta, 50);
eq('topProjectDelta.project', S.topProjectDelta!.project, 'A');
approx('topProjectDelta.delta', S.topProjectDelta!.delta, 56);

// levers: cacheWrite pool 50 → save 10 / output pool 10 → save 2.5 / opus pool 10 → save 1.2
eq('lever order', S.levers.map((l) => l.key), ['cacheWrite', 'output', 'opus']);
approx('cacheWrite estSaving', S.levers[0].estSaving, 10);
approx('output estSaving', S.levers[1].estSaving, 2.5);
approx('opus estSaving', S.levers[2].estSaving, 1.2);
eq('basis', S.basis, 'recent7-vs-prev7');
eq('recentStart echoed', S.recentStart, '2026-06-23');

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nall savings smoke assertions passed');
