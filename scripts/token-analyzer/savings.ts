/* FinLens 절감 임팩트 계산 — 순수 함수 (부수효과 0, 의존성 0).
 * 최근 7일 vs 직전 7일 윈도우로 비용을 분해하고, 레버별 시나리오 절감 추정을 산출한다.
 * 절감액은 모두 "가정 기반 상한 추정" — 실제 청구가 아니다. */

export interface SavingsRecord {
  ts: number;
  model: string;
  project: string;
  input: number;
  output: number;
  costIn: number;
  costOut: number;
  costRead: number;
  costW5: number;
  costW1: number;
}

export interface Lever {
  key: 'cacheWrite' | 'opus' | 'output';
  title: string;
  pool7d: number;
  prev7d: number;
  delta: number;
  estSaving: number;
  assumption: string;
  driverHint: string;
  promptKey: 'cacheWrite' | 'opus' | 'output';
}

export interface SavingsBlock {
  basis: 'recent7-vs-prev7';
  recentStart: string;
  recentCost: number;
  prevCost: number;
  delta: number;
  deltaPct: number | null;
  hasPrev: boolean;
  topDriver: { kind: 'model' | 'type'; name: string; delta: number } | null;
  topProjectDelta: { project: string; delta: number } | null;
  levers: Lever[];
}

// 보수적 고정 가정 (스펙 §5.3). 변경은 여기 한 곳에서.
const ASSUME = {
  opusDowngradeFraction: 0.3, // 최근 Opus 비용의 30%를 Sonnet으로 전환 가정
  sonnetSavingRate: 0.4, // Sonnet = Opus 단가의 60% → 40% 절감
  cacheWriteReducible: 0.2, // 세션 단축·prefix 축소로 캐시쓰기 20% 절감
  outputReducible: 0.25, // 간결 출력으로 output 25% 절감
};

interface WindowAgg {
  cost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  cacheWrite1hCost: number;
  opusCost: number;
  inputTok: number;
  outputTok: number;
  byModel: Record<string, number>;
  byProject: Record<string, number>;
}

function emptyWindow(): WindowAgg {
  return {
    cost: 0, inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0,
    cacheWrite1hCost: 0, opusCost: 0, inputTok: 0, outputTok: 0, byModel: {}, byProject: {},
  };
}

function addTo(w: WindowAgg, r: SavingsRecord): void {
  const cost = r.costIn + r.costOut + r.costRead + r.costW5 + r.costW1;
  w.cost += cost;
  w.inputCost += r.costIn;
  w.outputCost += r.costOut;
  w.cacheReadCost += r.costRead;
  w.cacheWriteCost += r.costW5 + r.costW1;
  w.cacheWrite1hCost += r.costW1;
  w.inputTok += r.input;
  w.outputTok += r.output;
  if (r.model.indexOf('opus') >= 0) {
    w.opusCost += cost;
  }
  w.byModel[r.model] = (w.byModel[r.model] || 0) + cost;
  w.byProject[r.project] = (w.byProject[r.project] || 0) + cost;
}

const round = (n: number): number => Math.round(n * 10000) / 10000;
const pctStr = (n: number): string => `${(n * 100).toFixed(0)}%`;
const usd = (n: number): string => (Math.abs(n) >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);

export function computeSavings(
  records: SavingsRecord[],
  opts: { recentStart: number; prevStart: number; recentStartDay: string },
): SavingsBlock {
  const recent = emptyWindow();
  const prev = emptyWindow();
  for (const r of records) {
    if (r.ts >= opts.recentStart) {
      addTo(recent, r);
    } else if (r.ts >= opts.prevStart) {
      addTo(prev, r);
    }
  }

  const delta = recent.cost - prev.cost;
  const deltaPct = prev.cost > 0 ? round(delta / prev.cost) : null;

  // topDriver: 모델별·비용유형별 delta 중 최대 양(+). 동률 시 type 우선(먼저 평가).
  const drivers: { kind: 'model' | 'type'; name: string; delta: number }[] = [];
  const types: [string, number, number][] = [
    ['cacheWrite', recent.cacheWriteCost, prev.cacheWriteCost],
    ['output', recent.outputCost, prev.outputCost],
    ['input', recent.inputCost, prev.inputCost],
    ['cacheRead', recent.cacheReadCost, prev.cacheReadCost],
  ];
  for (const [name, rc, pc] of types) {
    drivers.push({ kind: 'type', name, delta: round(rc - pc) });
  }
  const modelNames = new Set([...Object.keys(recent.byModel), ...Object.keys(prev.byModel)]);
  for (const name of modelNames) {
    drivers.push({ kind: 'model', name, delta: round((recent.byModel[name] || 0) - (prev.byModel[name] || 0)) });
  }
  let topDriver: SavingsBlock['topDriver'] = null;
  for (const d of drivers) {
    if (d.delta > 0 && (!topDriver || d.delta > topDriver.delta)) {
      topDriver = d;
    }
  }

  // topProjectDelta
  const projNames = new Set([...Object.keys(recent.byProject), ...Object.keys(prev.byProject)]);
  let topProjectDelta: SavingsBlock['topProjectDelta'] = null;
  for (const name of projNames) {
    const d = round((recent.byProject[name] || 0) - (prev.byProject[name] || 0));
    if (d > 0 && (!topProjectDelta || d > topProjectDelta.delta)) {
      topProjectDelta = { project: name, delta: d };
    }
  }

  // 레버 후보
  const opusShare = recent.cost > 0 ? recent.opusCost / recent.cost : 0;
  const cwShare = recent.cost > 0 ? recent.cacheWriteCost / recent.cost : 0;
  const outInRatio = recent.inputTok > 0 ? recent.outputTok / recent.inputTok : 0;

  const candidates: Lever[] = [
    {
      key: 'cacheWrite',
      title: '캐시 쓰기 / 세션·프리픽스 줄이기',
      pool7d: round(recent.cacheWriteCost),
      prev7d: round(prev.cacheWriteCost),
      delta: round(recent.cacheWriteCost - prev.cacheWriteCost),
      estSaving: round(recent.cacheWriteCost * ASSUME.cacheWriteReducible),
      assumption: '세션 단축·프리픽스(MCP·커넥터) 축소로 캐시 쓰기 20% 절감 가정',
      driverHint: `캐시 쓰기가 최근 비용의 ${pctStr(cwShare)} · 1h쓰기 ${usd(recent.cacheWrite1hCost)}`,
      promptKey: 'cacheWrite',
    },
    {
      key: 'opus',
      title: 'Opus 비중 줄이기',
      pool7d: round(recent.opusCost),
      prev7d: round(prev.opusCost),
      delta: round(recent.opusCost - prev.opusCost),
      estSaving: round(recent.opusCost * ASSUME.opusDowngradeFraction * ASSUME.sonnetSavingRate),
      assumption: 'Opus 작업의 30%를 Sonnet으로 전환, Sonnet=Opus 단가의 60% 가정',
      driverHint: `최근 Opus 비중 ${pctStr(opusShare)} · 직전 대비 ${usd(recent.opusCost - prev.opusCost)}`,
      promptKey: 'opus',
    },
    {
      key: 'output',
      title: '출력 길이 줄이기',
      pool7d: round(recent.outputCost),
      prev7d: round(prev.outputCost),
      delta: round(recent.outputCost - prev.outputCost),
      estSaving: round(recent.outputCost * ASSUME.outputReducible),
      assumption: '결론부터·간결 출력으로 output 25% 절감 가정',
      driverHint: `output:input 토큰 비율 ${outInRatio.toFixed(2)}`,
      promptKey: 'output',
    },
  ];

  // 의미 필터 + estSaving 내림차순
  const floor = Math.max(0.5, recent.cost * 0.02);
  const levers = candidates
    .filter((l) => l.pool7d >= floor)
    .sort((a, b) => b.estSaving - a.estSaving);

  return {
    basis: 'recent7-vs-prev7',
    recentStart: opts.recentStartDay,
    recentCost: round(recent.cost),
    prevCost: round(prev.cost),
    delta: round(delta),
    deltaPct,
    hasPrev: prev.cost > 0,
    topDriver,
    topProjectDelta,
    levers,
  };
}
