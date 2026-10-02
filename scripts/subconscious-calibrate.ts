// subconscious 게이트 문턱 오프라인 보정 — shadow 원장(subconscious_gate_shadow)과 사람 판정
// (subconscious_proposal: DISPATCHED=실행, DISMISSED=무시)을 붙여 판별력과 문턱별 효과를 출력한다.
//
// 이 스크립트는 promote 문턱(SUBCONSCIOUS_JEV_PROMOTE_THRESHOLD)을 볼 재료만 낸다. 실제 hybrid 게이트는
// promote AND agent confidence 를 둘 다 넘을 때만 확신 승격하고 나머지는 legacy 가 다시 판정하므로,
// 문턱 표는 "shadow 모델 단독 게이트였다면" 의 가정이다. 바꾸는 것은 사람이 .env 로 한다.
// 읽기만 하고 아무것도 쓰지 않는다.
//
// 사용:
//   pnpm subconscious:calibrate
//   (= node --env-file-if-exists=.env -r ts-node/register/transpile-only scripts/subconscious-calibrate.ts)
//
// 표본 해석 주의:
// - GATE 카드는 legacy 가 전부 "올리자" 고 한 건이라 legacy 판별력은 그 안에서 정의상 0.5 다.
//   legacy 와 비교하려면 DROP_SAMPLE(legacy 가 버린 건) 라벨이 있어야 한다.
// - DROP_SAMPLE 은 버린 건의 일부만 뽑은 표본이라 모집단 비율과 다르다(가중치 보정 안 함).

import { PrismaClient } from '@prisma/client';

import {
  auroc,
  CalibrationItem,
  clusteredBootstrapAuroc,
  seededRandom,
  thresholdTable,
} from '../src/subconscious/domain/gate-calibration';

const prisma = new PrismaClient();

const LABELED_STATUSES = ['DISPATCHED', 'DISMISSED'];
const THRESHOLDS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98];
const BOOTSTRAP_ITERATIONS = 2000;
const BOOTSTRAP_SEED = 7;
// 이보다 적으면 어떤 차이도 0.5 와 구분되지 않는다(2026-10-02 실측: 양성 11·고유 7 로 구간 폭 ±0.17).
// 양성·음성 둘 다 본다 — AUROC 와 "무시 걸러냄" 은 음성이 모자라도 해석할 수 없고, 한쪽 클러스터가
// 적으면 bootstrap 반복 다수가 정의되지 않아 구간이 흔들린다.
const MIN_PER_LABEL = 30;
const MIN_CLUSTERS_PER_LABEL = 10;
// 같은 tick 안에서만 짝짓는다. 판정(legacy LLM 수십 초)과 카드 생성 사이의 여유. 이보다 오래된 shadow
// 행은 다른 상태의 대상을 본 것이라 라벨을 붙이면 안 된다(shadow 를 끈 뒤 생긴 카드 등).
const SAME_TICK_WINDOW_MS = 10 * 60 * 1000;

interface JoinedRow {
  readonly changeKey: string;
  readonly shadowModel: string;
  readonly origin: string;
  readonly label: boolean;
  readonly suggestedAgentType: string;
  readonly promoteProbability: number | null;
  readonly agentChoice: string | null;
  readonly legacyPromote: boolean | null;
}

const format = (value: number | null): string =>
  value === null ? '—' : value.toFixed(3);

const describeSample = (rows: readonly JoinedRow[]): string => {
  const positives = rows.filter((row) => row.label).length;
  const clusters = new Set(rows.map((row) => row.changeKey)).size;
  return `N=${rows.length} 실행=${positives} 무시=${rows.length - positives} 고유대상=${clusters}`;
};

const reportAuroc = (title: string, items: CalibrationItem[]): void => {
  const point = auroc(items);
  const interval = clusteredBootstrapAuroc(
    items,
    BOOTSTRAP_ITERATIONS,
    seededRandom(BOOTSTRAP_SEED),
  );
  const range = interval
    ? `[${format(interval.low)}, ${format(interval.high)}]`
    : '[—]';
  console.log(`  ${title}: AUROC=${format(point)} 95%구간(대상 단위) ${range}`);
};

interface JoinResult {
  readonly rows: JoinedRow[];
  readonly unmatched: number;
}

const loadJoinedRows = async (): Promise<JoinResult> => {
  const proposals = await prisma.subconsciousProposal.findMany({
    where: { status: { in: LABELED_STATUSES } },
    orderBy: { createdAt: 'asc' },
  });
  const joined: JoinedRow[] = [];
  let unmatched = 0;
  for (const proposal of proposals) {
    // 카드가 만들어지기 전 가장 가까운 shadow 판정 — 같은 회차에 남긴 행이다.
    const shadow = await prisma.subconsciousGateShadow.findFirst({
      where: {
        changeKey: proposal.changeKey,
        createdAt: {
          gte: new Date(proposal.createdAt.getTime() - SAME_TICK_WINDOW_MS),
          lte: proposal.createdAt,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!shadow) {
      unmatched += 1;
      continue;
    }
    joined.push({
      changeKey: proposal.changeKey,
      shadowModel: shadow.shadowModel,
      origin: proposal.origin,
      label: proposal.status === 'DISPATCHED',
      suggestedAgentType: proposal.suggestedAgentType,
      promoteProbability: shadow.promoteProbability,
      agentChoice: shadow.agentChoice,
      legacyPromote: shadow.legacyPromote,
    });
  }
  return { rows: joined, unmatched };
};

const reportModel = (model: string, rows: readonly JoinedRow[]): void => {
  console.log(`\n━━ shadow 모델: ${model} · ${describeSample(rows)}`);
  const scored = rows.filter((row) => row.promoteProbability !== null);
  const positives = scored.filter((row) => row.label);
  const negatives = scored.filter((row) => !row.label);
  const positiveClusters = new Set(positives.map((row) => row.changeKey)).size;
  const negativeClusters = new Set(negatives.map((row) => row.changeKey)).size;
  if (
    positives.length < MIN_PER_LABEL ||
    negatives.length < MIN_PER_LABEL ||
    positiveClusters < MIN_CLUSTERS_PER_LABEL ||
    negativeClusters < MIN_CLUSTERS_PER_LABEL
  ) {
    console.log(
      `판정 불가 — 표본 부족 (실행 ${positives.length}/${MIN_PER_LABEL}·고유 ${positiveClusters}/${MIN_CLUSTERS_PER_LABEL}, 무시 ${negatives.length}/${MIN_PER_LABEL}·고유 ${negativeClusters}/${MIN_CLUSTERS_PER_LABEL}). 아래 수치는 참고용이다.`,
    );
  }

  console.log('[판별력]');
  reportAuroc(
    'shadow promote 확률',
    scored.map((row) => ({
      cluster: row.changeKey,
      score: row.promoteProbability as number,
      label: row.label,
    })),
  );
  // shadow 와 같은 표본에서 잰다 — shadow 가 실패한 회차(점수 null)를 legacy 쪽에만 넣으면 두 수치가
  // 다른 모집단 위에 나란히 찍힌다.
  const legacyRows = scored.filter((row) => row.legacyPromote !== null);
  const excluded = rows.length - scored.length;
  if (excluded > 0) {
    console.log(
      `  (shadow 점수가 없는 ${excluded}행은 두 비교에서 모두 제외 — 호출 실패 회차)`,
    );
  }
  reportAuroc(
    'legacy 판정(0/1)',
    legacyRows.map((row) => ({
      cluster: row.changeKey,
      score: row.legacyPromote ? 1 : 0,
      label: row.label,
    })),
  );
  if (legacyRows.some((row) => row.origin === 'DROP_SAMPLE')) {
    console.log(
      '  ↳ DROP_SAMPLE 은 버린 건의 일부(비율·하루 상한)만 뽑아 가중치 없이 섞었다 — legacy 비교는 방향만 본다.',
    );
  }
  if (!legacyRows.some((row) => row.legacyPromote === false)) {
    console.log(
      '  ↳ legacy 가 버린 건의 라벨(DROP_SAMPLE)이 아직 없어 legacy 판별력은 정의상 0.5 다.',
    );
  }

  console.log(
    '\n[문턱별 효과 — shadow 모델 단독 게이트 가정, promote 확률만 적용]',
  );
  console.log('  문턱   실행 남김   무시 걸러냄');
  for (const row of thresholdTable(
    scored.map((item) => ({
      cluster: item.changeKey,
      score: item.promoteProbability as number,
      label: item.label,
    })),
    THRESHOLDS,
  )) {
    console.log(
      `  ${row.threshold.toFixed(2)}   ${row.keptPositive}/${row.totalPositive}        ${row.filteredNegative}/${row.totalNegative}`,
    );
  }

  const withAgent = rows.filter((row) => row.agentChoice !== null);
  if (withAgent.length > 0) {
    const matched = withAgent.filter(
      (row) => row.agentChoice === row.suggestedAgentType,
    ).length;
    const counts = new Map<string, number>();
    for (const row of withAgent) {
      counts.set(
        row.suggestedAgentType,
        (counts.get(row.suggestedAgentType) ?? 0) + 1,
      );
    }
    const majority = Math.max(...counts.values());
    console.log('\n[담당 워커]');
    console.log(
      `  shadow 선택과 카드 워커 일치 ${matched}/${withAgent.length} · 항상 최빈값 기준선 ${majority}/${withAgent.length}`,
    );
  }
};

const main = async (): Promise<void> => {
  const shadowCount = await prisma.subconsciousGateShadow.count();
  const shadowErrors = await prisma.subconsciousGateShadow.count({
    where: { error: { not: null } },
  });
  const { rows, unmatched } = await loadJoinedRows();
  // 라벨 없이 닫힌 카드 — 응답하지 않은 카드는 비중이 크고(2026-09-30 실측: 닫힌 62건 중 53건이 만료)
  // 선택 편향의 원천이라 조용히 빠지지 않게 수를 보인다.
  const unlabeled = await prisma.subconsciousProposal.groupBy({
    by: ['origin', 'status'],
    where: { status: { in: ['EXPIRED', 'SUPERSEDED'] } },
    _count: { _all: true },
  });

  console.log('== subconscious 게이트 문턱 보정 ==');
  console.log(
    `shadow 원장 ${shadowCount}행 (호출 실패 ${shadowErrors}행) · 사람 판정과 붙은 행 ${rows.length} · 같은 회차 shadow 없는 판정 ${unmatched}건(제외)`,
  );
  for (const origin of ['GATE', 'DROP_SAMPLE']) {
    const closed = unlabeled
      .filter((group) => group.origin === origin)
      .map((group) => `${group.status} ${group._count._all}`)
      .join(' · ');
    console.log(
      `  ${origin}: ${describeSample(rows.filter((row) => row.origin === origin))} · 라벨 없이 닫힘 ${closed || '0'}`,
    );
  }

  // 모델마다 점수 분포가 달라 한 표로 합치면 어느 모델에도 맞지 않는 문턱이 나온다.
  const models = [...new Set(rows.map((row) => row.shadowModel))].sort();
  if (models.length === 0) {
    console.log('\n판정 불가 — 사람 판정과 붙은 shadow 행이 없다.');
  }
  for (const model of models) {
    reportModel(
      model,
      rows.filter((row) => row.shadowModel === model),
    );
  }
};

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
