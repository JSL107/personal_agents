import { Inject, Injectable, Logger } from '@nestjs/common';

import { isBackendPosting } from '../domain/backend-role.filter';
import { toCompanyKey, toContentHash, toNormalizedKey } from '../domain/dedupe';
import { resolveExperienceLevel } from '../domain/experience';
import {
  NormalizedJobPosting,
  RawJobPosting,
  SourceFetchOutcome,
} from '../domain/job-feed.type';
import { resolveLocations } from '../domain/location';
import {
  JOB_POSTING_REPOSITORY_PORT,
  JobPostingRepositoryPort,
  UpsertOutcome,
} from '../domain/port/job-posting.repository.port';
import { JOB_SOURCES, JobSourcePort } from '../domain/port/job-source.port';
import { normalizeSkillTags } from '../domain/skill-dictionary';
import { JobFeedPermanentError } from '../infrastructure/job-feed-permanent.error';

export interface UnmatchedSkillTag {
  tag: string;
  count: number;
}

export interface CollectOutcome {
  outcomes: SourceFetchOutcome[];
  upsert: UpsertOutcome;
  unmatchedSkillTags: UnmatchedSkillTag[];
}

export interface CollectOptions {
  maxPages?: number;
  dryRun?: boolean;
}

interface SourceCollectResult {
  outcome: SourceFetchOutcome;
  postings: NormalizedJobPosting[];
  unmatched: string[];
}

// 모델을 부르지 않는 결정론 수집기라 AgentRunService(원장)를 쓰지 않는다 — 이 레포의
// screener/paper-trading 등 다른 수집·계산 계열과 같은 방식으로 부분 실패를 남긴다:
// 소스별 3단 계수(수신/검증/직군통과)를 이 로그 한 줄에, 저장 결과를 CollectOutcome
// 반환값에 담아 호출부(Task 12 CLI, Task 16 autopilot task)가 카드로 만든다.
@Injectable()
export class CollectJobPostingsUsecase {
  private readonly logger = new Logger(CollectJobPostingsUsecase.name);
  private readonly defaultMaxPages = 3;

  constructor(
    @Inject(JOB_SOURCES) private readonly sources: JobSourcePort[],
    @Inject(JOB_POSTING_REPOSITORY_PORT)
    private readonly repository: JobPostingRepositoryPort,
  ) {}

  async execute({
    maxPages,
    dryRun,
  }: CollectOptions = {}): Promise<CollectOutcome> {
    const pages = maxPages ?? this.defaultMaxPages;
    // 한 소스가 죽어도 나머지는 진행한다. 실패는 결과에 남겨 카드에 노출한다.
    const settled = await Promise.allSettled(
      this.sources.map((source) => {
        return this.collectFromSource(source, pages);
      }),
    );

    const outcomes: SourceFetchOutcome[] = [];
    const collected: NormalizedJobPosting[] = [];
    const unmatchedCounter = new Map<string, number>();

    for (const [index, entry] of settled.entries()) {
      if (entry.status === 'rejected') {
        outcomes.push({
          source: this.sources[index].source,
          status: 'FAILED',
          received: 0,
          validated: 0,
          accepted: 0,
          httpStatus: null,
          error: String(entry.reason),
        });
        continue;
      }
      outcomes.push(entry.value.outcome);
      collected.push(...entry.value.postings);
      for (const tag of entry.value.unmatched) {
        unmatchedCounter.set(tag, (unmatchedCounter.get(tag) ?? 0) + 1);
      }
    }

    const upsert =
      dryRun === true
        ? { created: 0, updated: 0, contentChanged: 0 }
        : await this.repository.upsertMany(collected);

    const unmatchedSkillTags = [...unmatchedCounter.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((left, right) => right.count - left.count);

    // 3단 계수 + 저장 결과를 한 줄로 남긴다. 원장이 없으므로 "부분 실패를 나중에
    // 되짚을 수 있게 하라"(스펙 §4-12)는 요구는 여기 로그와 반환값(CollectOutcome)
    // 둘로 충족한다.
    this.logger.log(
      `job-feed 수집 — ${outcomes
        .map((entry) => {
          return `${entry.source}:${entry.status}(${entry.received}/${entry.validated}/${entry.accepted})`;
        })
        .join(' ')} 저장 신규 ${upsert.created} 갱신 ${upsert.updated}`,
    );

    return { outcomes, upsert, unmatchedSkillTags };
  }

  private async collectFromSource(
    source: JobSourcePort,
    maxPages: number,
  ): Promise<SourceCollectResult> {
    let received = 0;
    let validated = 0;
    const accepted: NormalizedJobPosting[] = [];
    const unmatched: string[] = [];

    try {
      for (let page = 1; page <= maxPages; page += 1) {
        const result = await source.fetchList(page);
        received += result.received;
        validated += result.postings.length;

        for (const raw of result.postings) {
          const normalized = this.normalize(raw, unmatched);
          if (normalized !== null) {
            accepted.push(normalized);
          }
        }

        // 원티드는 목록 응답에 전체 건수가 없어 totalPages 가 Number.MAX_SAFE_INTEGER 로
        // 온다(무의미한 값) — 점핏·랠릿처럼 "서버가 준 실제 totalPages" 라는 독립 방어막이
        // 없다는 뜻이다. 그래서 정지 조건은 검증 통과 수(result.postings.length)가 아니라
        // 원시 수신 수(result.received)를 봐야 한다. 검증 통과 수로 멈추면, 한 페이지의
        // 원시 항목이 전부 검증 실패(예: 응답 형태가 바뀌어 company 필드가 사라짐)할 때
        // 실제로 데이터가 더 남아 있어도 조기 종료된다 — 그 조기 종료는 아래 "수신은 있는데
        // 검증 0" 판정과 별개 문제이므로 여기서 숨기면 안 된다.
        if (page >= result.totalPages || result.received === 0) {
          break;
        }
      }
    } catch (error) {
      return {
        outcome: {
          source: source.source,
          status: 'FAILED',
          received,
          validated,
          accepted: accepted.length,
          // 403/429 등 HTTP 상태를 카드에 실으면 진단 가치가 크다(차단인지 일시
          // 장애인지 사람이 바로 구분할 수 있다) — JobFeedPermanentError 일 때만
          // 실제 값을 채운다. 그 밖의 예외(네트워크 오류 등)는 상태 코드가 없다.
          httpStatus:
            error instanceof JobFeedPermanentError ? error.httpStatus : null,
          error: error instanceof Error ? error.message : String(error),
        },
        postings: accepted,
        unmatched,
      };
    }

    // 수신은 있는데 검증이 0이면 응답 형태가 바뀐 것이다. 조용히 넘기면 매일 0건이 된다.
    if (received > 0 && validated === 0) {
      return {
        outcome: {
          source: source.source,
          status: 'FAILED',
          received,
          validated,
          accepted: 0,
          httpStatus: null,
          error: `수신 ${received}건 중 검증 통과 0건 — 응답 형태 변경 의심`,
        },
        postings: [],
        unmatched,
      };
    }

    return {
      outcome: {
        source: source.source,
        status: 'SUCCESS',
        received,
        validated,
        accepted: accepted.length,
        httpStatus: null,
        error: null,
      },
      postings: accepted,
      unmatched,
    };
  }

  private normalize(
    raw: RawJobPosting,
    unmatchedSink: string[],
  ): NormalizedJobPosting | null {
    const skills = normalizeSkillTags(raw.rawSkillTags);

    if (
      !isBackendPosting({
        title: raw.title,
        skillTags: skills.identified,
        rawSkillTags: raw.rawSkillTags,
      })
    ) {
      return null;
    }

    // 미매칭 태그는 백엔드 사전 갱신 재료다(스펙 §4-3) — 직군 필터를 통과한 공고에서만
    // 모은다. 판정보다 앞에서 모으면 탈락한 공고(프론트 등)의 React·Vue.js·CSS 같은
    // 태그가 섞여, 정작 필요한 백엔드 신규 기술(Quarkus·Temporal 등)이 잡음에 묻힌다.
    unmatchedSink.push(...skills.unmatched);

    // raw 를 그대로 spread 하지 않고 NormalizedJobPosting 이 선언한 필드만 명시적으로
    // 나열한다. TypeScript 는 변수를 거쳐 전달된 객체가 "타입이 선언한 필드만 갖는다"를
    // 런타임에 보장하지 않는다(object literal 에만 excess property check 가 걸린다) —
    // `{ ...raw, ... }` 형태였다면 raw 에 여분 키가 실릴 때 그대로 저장소까지 전달되고,
    // Task 9 upsertMany 의 `update: { ...posting }` 전체 덮어쓰기가 매 수집 주기마다
    // matchScore·scoredProfileId·jdText·gapAgentRunId 를 조용히 지운다.
    const normalized: NormalizedJobPosting = {
      source: raw.source,
      sourceId: raw.sourceId,
      company: raw.company,
      companyKey: toCompanyKey(raw.company),
      title: raw.title,
      detailUrl: raw.detailUrl,
      skillTags: skills.identified,
      rawSkillTags: raw.rawSkillTags,
      minYears: raw.minYears,
      maxYears: raw.maxYears,
      yearsSource: raw.yearsSource,
      rawJobLevel: raw.rawJobLevel,
      experienceLevel: resolveExperienceLevel({
        minYears: raw.minYears,
        maxYears: raw.maxYears,
        isNewcomer: raw.isNewcomer,
      }),
      locations: resolveLocations(raw.source, raw.rawLocations),
      rawLocations: raw.rawLocations,
      normalizedKey: toNormalizedKey(raw.company, raw.title),
      contentHash: '',
    };
    return { ...normalized, contentHash: toContentHash(normalized) };
  }
}
