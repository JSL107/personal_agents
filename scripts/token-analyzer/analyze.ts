/* FinLens — 1인용 Claude Code 토큰/비용 분석기.
 *
 * Claude Code 가 ~/.claude/projects/<proj>/<session>.jsonl 에 쌓는 트랜스크립트를
 * 파싱해 토큰 4종(input/output/cache-write/cache-read)을 공개 단가표로 환산하고,
 * 시간·모델·프로젝트별로 집계 + 자동 절감 인사이트 + 프로젝트 변화(신규/급증/급감/비활성)를
 * 계산해 self-contained HTML 대시보드(dashboard.html)를 생성한다.
 *
 * 사용:
 *   pnpm exec ts-node --transpile-only scripts/token-analyzer/analyze.ts
 *   open scripts/token-analyzer/dashboard.html
 *
 * 정확성 메모:
 *   - dedupe: requestId + message.id (스트리밍/리트라이/재개로 같은 메시지가 여러 줄에 기록됨)
 *   - cache_creation 은 ephemeral_5m(×1.25) / ephemeral_1h(×2.0) 분리 과금
 *   - 환산 $ 는 "API 단가로 썼다면" 효율 지표 — Claude Max/ChatGPT 구독 실제 청구가 아님
 *   - 프롬프트/응답 본문은 읽지 않음 (usage 메타데이터만)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { computeSavings } from './savings';

// ── 단가표 (per 1M tokens) [input, output]. cache read=×0.1, write5m=×1.25, write1h=×2.0 ──
const PRICES: Record<string, [number, number]> = {
  'claude-opus-4-8': [5, 25],
  'claude-opus-4-7': [5, 25],
  'claude-opus-4-6': [5, 25],
  'claude-opus-4-5': [5, 25],
  'claude-opus-4-1': [15, 75],
  'claude-opus-4-0': [15, 75],
  'claude-3-opus': [15, 75],
  'claude-fable-5': [10, 50],
  'claude-mythos-5': [10, 50],
  'claude-sonnet-4-6': [3, 15],
  'claude-sonnet-4-5': [3, 15],
  'claude-sonnet-4-0': [3, 15],
  'claude-3-5-sonnet': [3, 15],
  'claude-3-7-sonnet': [3, 15],
  'claude-haiku-4-5': [1, 5],
  'claude-3-5-haiku': [0.8, 4],
  'claude-3-haiku': [0.25, 1.25],
};

const unknownModels = new Set<string>();

function priceFor(model: string): [number, number] {
  if (PRICES[model]) {
    return PRICES[model];
  }
  const m = model || '';
  if (/opus-4-(5|6|7|8)/.test(m)) {
    return [5, 25];
  }
  if (m.includes('opus')) {
    return [15, 75];
  }
  if (m.includes('fable') || m.includes('mythos')) {
    return [10, 50];
  }
  if (m.includes('sonnet')) {
    return [3, 15];
  }
  if (/haiku-4/.test(m)) {
    return [1, 5];
  }
  if (m.includes('haiku')) {
    return [0.8, 4];
  }
  unknownModels.add(model);
  return [0, 0];
}

// ── 집계 버킷 ──
interface Bucket {
  cost: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number; // 5m + 1h 합산 토큰
  requests: number;
}

function emptyBucket(): Bucket {
  return { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 };
}

function addTo(b: Bucket, rec: Parsed): void {
  b.cost += rec.cost;
  b.input += rec.input;
  b.output += rec.output;
  b.cacheRead += rec.cacheRead;
  b.cacheWrite += rec.cacheWrite5m + rec.cacheWrite1h;
  b.requests += 1;
}

interface Parsed {
  ts: number;
  day: string;
  model: string;
  project: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cost: number;
  inPriceMTok: number;
  costIn: number;
  costOut: number;
  costRead: number;
  costW5: number;
  costW1: number;
}

const projectCache = new Map<string, string>();
// 사이드 클론(같은 repo 의 별도 체크아웃)을 본체로 병합.
const PROJECT_ALIASES: Record<string, string> = {
  'sbe-api-v5-puppeteer-crawl-diag': 'sbe-api-v5-puppeteer',
  'sbe-api-v5-puppeteer-dash-layout': 'sbe-api-v5-puppeteer',
};
function projectLabel(cwd: string): string {
  if (!cwd) {
    return '(unknown)';
  }
  const cached = projectCache.get(cwd);
  if (cached !== undefined) {
    return cached;
  }
  let label: string;
  if (/^\/(private\/)?tmp(\/|$)/.test(cwd)) {
    // /tmp, /private/tmp 하위는 일회성 스크래치(PR 머지·핫픽스·시드 등) → 한 버킷으로.
    label = '(scratch)';
  } else {
    // 워크트리 경로(<repo>/.claude/worktrees/<name>, <repo>/.worktrees/<name>)는 본체 repo 로 접는다.
    const base = cwd.replace(/\/\.claude\/worktrees\/.*$/, '').replace(/\/\.worktrees\/.*$/, '');
    try {
      // .git 을 상향 탐색해 repo 루트를 찾는다 (하위폴더 cwd 도 repo 로 모음).
      let dir = base;
      let root = '';
      for (let i = 0; i < 12 && dir && dir !== '/' && dir !== '.'; i++) {
        if (fs.existsSync(path.join(dir, '.git'))) {
          root = dir;
          break;
        }
        dir = path.dirname(dir);
      }
      // git repo 가 아닌 cwd(상위 폴더에서 직접 실행, '/' 등)는 기타로 묶는다.
      label = root ? path.basename(root) : '(기타)';
      label = PROJECT_ALIASES[label] || label;
    } catch {
      label = '(기타)';
    }
  }
  projectCache.set(cwd, label);
  return label;
}

function dayOf(ts: number): string {
  // UTC 날짜 (안정적). KST 보정이 필요하면 +9h. 일별 추세 비교는 일관성만 있으면 됨.
  return new Date(ts).toISOString().slice(0, 10);
}

async function* walkJsonl(root: string): AsyncGenerator<string> {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      yield* walkJsonl(full);
    } else if (e.isFile() && e.name.endsWith('.jsonl')) {
      yield full;
    }
  }
}

async function main(): Promise<void> {
  const home = os.homedir();
  const root = path.join(home, '.claude', 'projects');
  if (!fs.existsSync(root)) {
    console.error(`경로 없음: ${root}`);
    process.exit(1);
  }

  const seen = new Set<string>();
  const totals = emptyBucket();
  let cacheWrite5mTok = 0;
  let cacheWrite1hTok = 0;
  let cacheWrite5mCost = 0;
  let cacheWrite1hCost = 0;
  let cacheReadCost = 0;
  let inputCost = 0;
  let outputCost = 0;

  const byModel: Record<string, Bucket> = {};
  const byProject: Record<string, Bucket> = {};
  const dayMap: Record<string, any> = {};
  // 프로젝트별 first/last 활동 + 최근/직전 7일 비용 (변화 패널용)
  const projMeta: Record<string, { first: number; last: number; recent: number; prev: number }> = {};

  let minTs = Infinity;
  let maxTs = -Infinity;
  let fileCount = 0;
  let lineCount = 0;
  let usedCount = 0;

  const files: string[] = [];
  for await (const f of walkJsonl(root)) {
    files.push(f);
  }

  // maxTs 를 먼저 알아야 "최근 7일" 윈도우를 잡는데, 1-pass 로 처리하려고 일단
  // 레코드를 가볍게 모았다가 후처리한다. (메타만 — 본문 미보관)
  const records: Parsed[] = [];

  for (const file of files) {
    fileCount++;
    if (fileCount % 100 === 0) {
      process.stderr.write(`  파싱 중... ${fileCount}/${files.length} 파일\n`);
    }
    const rl = readline.createInterface({
      input: fs.createReadStream(file, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line) {
        continue;
      }
      lineCount++;
      let o: any;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (o.type !== 'assistant') {
        continue;
      }
      const msg = o.message || {};
      const usage = msg.usage;
      if (!usage) {
        continue;
      }
      const model: string = msg.model || '';
      if (!model || model === '<synthetic>') {
        continue;
      }
      const dedupeKey = `${o.requestId || ''}:${msg.id || o.uuid || ''}`;
      if (dedupeKey !== ':' && seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      const input = usage.input_tokens || 0;
      const output = usage.output_tokens || 0;
      const cacheRead = usage.cache_read_input_tokens || 0;
      const cc = usage.cache_creation || {};
      const w5 = cc.ephemeral_5m_input_tokens != null
        ? cc.ephemeral_5m_input_tokens
        : usage.cache_creation_input_tokens || 0;
      const w1 = cc.ephemeral_1h_input_tokens || 0;

      if (input + output + cacheRead + w5 + w1 === 0) {
        continue;
      }

      const [inP, outP] = priceFor(model);
      const cIn = (input * inP) / 1e6;
      const cOut = (output * outP) / 1e6;
      const cRead = (cacheRead * inP * 0.1) / 1e6;
      const cW5 = (w5 * inP * 1.25) / 1e6;
      const cW1 = (w1 * inP * 2.0) / 1e6;
      const cost = cIn + cOut + cRead + cW5 + cW1;

      const tsRaw = o.timestamp ? Date.parse(o.timestamp) : NaN;
      const ts = Number.isFinite(tsRaw) ? tsRaw : 0;
      const project = projectLabel(o.cwd || '');

      const rec: Parsed = {
        ts,
        day: ts ? dayOf(ts) : 'unknown',
        model,
        project,
        input,
        output,
        cacheRead,
        cacheWrite5m: w5,
        cacheWrite1h: w1,
        cost,
        inPriceMTok: inP,
        costIn: cIn,
        costOut: cOut,
        costRead: cRead,
        costW5: cW5,
        costW1: cW1,
      };
      records.push(rec);
      usedCount++;

      // 누적 코스트 구성
      inputCost += cIn;
      outputCost += cOut;
      cacheReadCost += cRead;
      cacheWrite5mCost += cW5;
      cacheWrite1hCost += cW1;
      cacheWrite5mTok += w5;
      cacheWrite1hTok += w1;

      if (ts) {
        if (ts < minTs) {
          minTs = ts;
        }
        if (ts > maxTs) {
          maxTs = ts;
        }
      }
    }
  }

  // 후처리 — maxTs 기준 최근/직전 7일 윈도우
  const DAY = 86400_000;
  const nowRef = Number.isFinite(maxTs) ? maxTs : Date.now();
  const recentStart = nowRef - 7 * DAY;
  const prevStart = nowRef - 14 * DAY;

  for (const rec of records) {
    addTo(totals, rec);
    (byModel[rec.model] ||= emptyBucket());
    addTo(byModel[rec.model], rec);
    (byProject[rec.project] ||= emptyBucket());
    addTo(byProject[rec.project], rec);
    if (rec.day !== 'unknown') {
      const dm = (dayMap[rec.day] ||= { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, ct: { i: 0, o: 0, r: 0, w5: 0, w1: 0 }, w5t: 0, w1t: 0, m: {}, p: {} });
      dm.cost += rec.cost; dm.input += rec.input; dm.output += rec.output; dm.cacheRead += rec.cacheRead; dm.cacheWrite += rec.cacheWrite5m + rec.cacheWrite1h; dm.requests += 1;
      dm.ct.i += rec.costIn; dm.ct.o += rec.costOut; dm.ct.r += rec.costRead; dm.ct.w5 += rec.costW5; dm.ct.w1 += rec.costW1;
      dm.w5t += rec.cacheWrite5m; dm.w1t += rec.cacheWrite1h;
      const mm = (dm.m[rec.model] ||= { c: 0, i: 0, o: 0, r: 0, w: 0, rq: 0 });
      mm.c += rec.cost; mm.i += rec.input; mm.o += rec.output; mm.r += rec.cacheRead; mm.w += rec.cacheWrite5m + rec.cacheWrite1h; mm.rq += 1;
      const pp = (dm.p[rec.project] ||= { c: 0, rq: 0 });
      pp.c += rec.cost; pp.rq += 1;
    }

    const pm = (projMeta[rec.project] ||= { first: Infinity, last: -Infinity, recent: 0, prev: 0 });
    if (rec.ts) {
      if (rec.ts < pm.first) {
        pm.first = rec.ts;
      }
      if (rec.ts > pm.last) {
        pm.last = rec.ts;
      }
      if (rec.ts >= recentStart) {
        pm.recent += rec.cost;
      } else if (rec.ts >= prevStart) {
        pm.prev += rec.cost;
      }
    }
  }

  // 정렬된 배열로 변환
  const round = (n: number): number => Math.round(n * 10000) / 10000;
  const bucketOut = (b: Bucket) => ({
    cost: round(b.cost),
    input: b.input,
    output: b.output,
    cacheRead: b.cacheRead,
    cacheWrite: b.cacheWrite,
    requests: b.requests,
  });

  const days = Object.keys(dayMap)
    .sort()
    .map((d) => {
      const dm = dayMap[d];
      const m: Record<string, any> = {};
      for (const k of Object.keys(dm.m)) {
        const x = dm.m[k];
        m[k] = { c: round(x.c), i: x.i, o: x.o, r: x.r, w: x.w, rq: x.rq };
      }
      const p: Record<string, any> = {};
      for (const k of Object.keys(dm.p)) {
        const x = dm.p[k];
        p[k] = { c: round(x.c), rq: x.rq };
      }
      return {
        day: d,
        cost: round(dm.cost),
        input: dm.input,
        output: dm.output,
        cacheRead: dm.cacheRead,
        cacheWrite: dm.cacheWrite,
        requests: dm.requests,
        ct: { i: round(dm.ct.i), o: round(dm.ct.o), r: round(dm.ct.r), w5: round(dm.ct.w5), w1: round(dm.ct.w1) },
        w5t: dm.w5t,
        w1t: dm.w1t,
        m: m,
        p: p,
      };
    });

  const models = Object.entries(byModel)
    .map(([model, b]) => ({ model, ...bucketOut(b) }))
    .sort((a, b) => b.cost - a.cost);

  const projects = Object.entries(byProject)
    .map(([project, b]) => {
      const pm = projMeta[project] || { first: 0, last: 0, recent: 0, prev: 0 };
      return {
        project,
        ...bucketOut(b),
        first: pm.first === Infinity ? null : pm.first,
        last: pm.last === -Infinity ? null : pm.last,
        recent: round(pm.recent),
        prev: round(pm.prev),
        delta: round(pm.recent - pm.prev),
      };
    })
    .sort((a, b) => b.cost - a.cost);

  // ── 프로젝트 변화 패널 ──
  const newProjects = projects
    .filter((p) => p.first != null && p.first >= recentStart)
    .sort((a, b) => (b.first || 0) - (a.first || 0));
  const inactive = projects
    .filter((p) => p.last != null && p.last < nowRef - 14 * DAY)
    .sort((a, b) => (b.last || 0) - (a.last || 0));
  const moversUp = projects
    .filter((p) => p.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 6);
  const moversDown = projects
    .filter((p) => p.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 6);

  // ── 자동 인사이트 ──
  const insights: { sev: string; title: string; detail: string }[] = [];
  const fmt$ = (n: number): string => `$${n.toFixed(2)}`;
  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

  // 캐시 절감 = cacheRead 토큰을 full input 으로 냈을 때 대비 (0.1× 만 냄 → 0.9× 절감)
  let cacheSaved = 0;
  let cacheReadInputEquivalent = 0;
  for (const rec of records) {
    cacheSaved += (rec.cacheRead * rec.inPriceMTok * 0.9) / 1e6;
    cacheReadInputEquivalent += rec.cacheRead;
  }
  const inputSideTokens = totals.input + totals.cacheRead + totals.cacheWrite;
  const cacheHitRatio = inputSideTokens > 0 ? totals.cacheRead / inputSideTokens : 0;
  const outInRatio = totals.input > 0 ? totals.output / totals.input : 0;

  insights.push({
    sev: 'good',
    title: `캐시로 ${fmt$(cacheSaved)} 절감 (히트율 ${pct(cacheHitRatio)})`,
    detail: `cache read ${(totals.cacheRead / 1e6).toFixed(1)}M 토큰을 full input 대신 0.1× 로 처리. 히트율이 낮으면 prompt prefix 안정성을 점검.`,
  });

  const opusCost = models.filter((m) => m.model.includes('opus')).reduce((s, m) => s + m.cost, 0);
  if (totals.cost > 0 && opusCost / totals.cost > 0.5) {
    insights.push({
      sev: 'mid',
      title: `Opus가 비용의 ${pct(opusCost / totals.cost)} 차지`,
      detail: `Opus 환산 ${fmt$(opusCost)}. 단순 작업(분류·요약·짧은 편집)은 Sonnet/Haiku 로 내려도 품질 유지 가능 — 라이트사이징 1순위.`,
    });
  }

  if (projects[0]) {
    insights.push({
      sev: 'info',
      title: `최대 소비 프로젝트: ${projects[0].project} (${fmt$(projects[0].cost)})`,
      detail: `전체 ${fmt$(totals.cost)} 중 ${pct(totals.cost > 0 ? projects[0].cost / totals.cost : 0)}. "어디서 토큰이 새는지"의 1순위.`,
    });
  }

  if (moversUp[0] && moversUp[0].delta > 0) {
    insights.push({
      sev: 'mid',
      title: `급증: ${moversUp[0].project} 직전7일 대비 +${fmt$(moversUp[0].delta)}`,
      detail: `직전 ${fmt$(moversUp[0].prev)} → 최근 ${fmt$(moversUp[0].recent)}. 비용이 튀면 여기부터 본다.`,
    });
  }

  if (newProjects.length > 0) {
    insights.push({
      sev: 'info',
      title: `최근 7일 신규 프로젝트 ${newProjects.length}개`,
      detail: newProjects.slice(0, 4).map((p) => p.project).join(', ') + (newProjects.length > 4 ? ' …' : ''),
    });
  }

  // 가장 비싼 날 + 그날 주원인 모델
  let topDay: { day: string; cost: number } | null = null;
  for (const d of days) {
    if (!topDay || d.cost > topDay.cost) {
      topDay = { day: d.day, cost: d.cost };
    }
  }
  if (topDay) {
    insights.push({
      sev: 'info',
      title: `최고 지출일: ${topDay.day} (${fmt$(topDay.cost)})`,
      detail: `일평균 ${fmt$(days.length ? totals.cost / days.length : 0)} 대비. spike 면 그날 작업/배포를 회고.`,
    });
  }

  insights.push({
    sev: outInRatio > 0.4 ? 'mid' : 'info',
    title: `output:input 비율 ${outInRatio.toFixed(2)}`,
    detail: `output 은 input 의 ~3~5배 단가. 비율이 높으면 max_tokens 상한·간결 출력으로 절감 여지.`,
  });

  if (unknownModels.size > 0) {
    insights.push({
      sev: 'mid',
      title: `단가 미매핑 모델 ${unknownModels.size}종 (비용 0 처리)`,
      detail: Array.from(unknownModels).slice(0, 6).join(', ') + ' — analyze.ts PRICES 에 추가하면 반영됨.',
    });
  }

  const data = {
    generatedNote: 'API 단가 환산치 — Claude Max/ChatGPT 구독 실제 청구 아님',
    rangeStart: Number.isFinite(minTs) ? dayOf(minTs) : null,
    rangeEnd: Number.isFinite(maxTs) ? dayOf(maxTs) : null,
    nowRef,
    stats: {
      files: files.length,
      lines: lineCount,
      used: usedCount,
      deduped: seen.size,
    },
    totals: {
      ...bucketOut(totals),
      inputCost: round(inputCost),
      outputCost: round(outputCost),
      cacheReadCost: round(cacheReadCost),
      cacheWrite5mCost: round(cacheWrite5mCost),
      cacheWrite1hCost: round(cacheWrite1hCost),
      cacheWrite5mTok,
      cacheWrite1hTok,
      cacheSaved: round(cacheSaved),
      cacheHitRatio: round(cacheHitRatio),
      outInRatio: round(outInRatio),
      days: days.length,
    },
    days,
    models,
    projects,
    changes: {
      newProjects: newProjects.slice(0, 8),
      inactive: inactive.slice(0, 8),
      moversUp,
      moversDown,
    },
    insights,
    savings: computeSavings(records, {
      recentStart,
      prevStart,
      recentStartDay: dayOf(recentStart),
    }),
  };

  // data.json 출력 (dashboard.html 이 fetch 로 읽음 — 서버 서빙용)
  const dir = __dirname;
  const outPath = path.join(dir, 'data.json');
  fs.writeFileSync(outPath, JSON.stringify(data), 'utf8');

  // 요약 출력
  console.log('─'.repeat(60));
  console.log(`파일 ${files.length} · 라인 ${lineCount.toLocaleString()} · 집계 메시지 ${usedCount.toLocaleString()}`);
  console.log(`기간: ${data.rangeStart} ~ ${data.rangeEnd} (${days.length}일)`);
  console.log(`총 환산 비용: ${fmt$(totals.cost)}  (input ${fmt$(inputCost)} / output ${fmt$(outputCost)} / cacheWrite ${fmt$(cacheWrite5mCost + cacheWrite1hCost)} / cacheRead ${fmt$(cacheReadCost)})`);
  console.log(`캐시 절감: ${fmt$(cacheSaved)} · 히트율 ${pct(cacheHitRatio)} · output:input ${outInRatio.toFixed(2)}`);
  console.log(`모델 ${models.length}종 · 프로젝트 ${projects.length}개`);
  if (unknownModels.size > 0) {
    console.log(`⚠️  단가 미매핑: ${Array.from(unknownModels).join(', ')}`);
  }
  if (data.savings.levers.length) {
    console.log(`절감 임팩트(최근7 vs 직전7): 최대 레버 ${fmt$(data.savings.levers[0].estSaving)}/주 · 레버 ${data.savings.levers.map((l) => l.key).join(', ')}`);
  }
  console.log(`✅ 생성: ${outPath}`);
  console.log('─'.repeat(60));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
