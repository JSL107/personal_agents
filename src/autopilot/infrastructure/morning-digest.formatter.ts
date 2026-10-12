import {
  escapeSlackMrkdwn,
  isSafeHttpUrl,
  sanitizeForSlackLink,
} from '../../slack/format/mrkdwn.util';
import { formatTradeDay } from './paper-number.formatter';

// 아침 한 통 — "할 일" 을 맨 위에, 나머지를 한 줄씩.
// 방향: docs/superpowers/plans/2026-10-08-daily-message-direction.md §3-1.
//
// 첫 줄에는 개수만이 아니라 종류를 적는다. 할 일이 0개인 날은 19일 중 하루뿐이라(§3-1),
// "할 일 N" 만 매일 보이면 그 숫자가 배경이 된다 — 3초 판단의 근거는 종류다.

export interface MorningIncident {
  label: string;
  dayCount: number;
}

export interface MorningPosting {
  company: string;
  title: string;
}

export interface MorningDigestInput {
  firedAtKst: string;
  // 열린 승인 카드의 짧은 이름(카드마다 하나). 같은 이름이 여럿이면 묶어 센다.
  approvalLabels: string[];
  incidents: MorningIncident[];
  // null = 공고 수집이 꺼져 있다(줄 자체를 내지 않는다). [] = 켜져 있으나 새 공고 없음.
  postings: MorningPosting[] | null;
  // 공고 수집이 멈춘 것 같을 때만 채운다. 새 공고 0건과 수집 정지를 구분하려는 줄이다 —
  // job-feed 메시지의 각주가 하던 일을 여기서 이어받는다. lastCollectedOn 이 null 이면 수집된 적이 없다.
  stalePostingCollection: { lastCollectedOn: string | null } | null;
  invest: { buyCount: number; sellCount: number } | null;
  // PM 계획의 최우선 1건. 회사 일의 "먼저 이것부터" 출처는 이것 하나다(§5 결정 갱신).
  company: { title: string; url: string | null } | null;
  study: { topic: string; url: string | null } | null;
  // 어제 23시 포트폴리오 발행 보고를 한 줄로 접은 것. 보고가 없던 날은 null.
  portfolio: string | null;
}

// 할 일 줄에 공고 이름을 몇 개까지 적나. 나머지는 "외 N" 으로 접고 목록은 스레드에 있다.
const MAX_POSTING_NAMES = 2;
const STUDY_MINUTES = 15;

const countByLabel = (labels: string[]): string =>
  [...new Set(labels)]
    .map((label) => {
      const count = labels.filter((item) => item === label).length;
      return count > 1 ? `${label}×${count}` : label;
    })
    .join(' · ');

// 모델·외부 원문이 들어오는 자리라, 링크가 없을 때도 `<` `&` 가 멘션·링크로 해석되지 않게 막는다.
const link = (text: string, url: string | null): string =>
  url && isSafeHttpUrl(url)
    ? `<${sanitizeForSlackLink(url)}|${sanitizeForSlackLink(text)}>`
    : escapeSlackMrkdwn(text);

const formatPostingNames = (postings: MorningPosting[]): string => {
  const names = postings
    .slice(0, MAX_POSTING_NAMES)
    // 회사명·제목은 채용 사이트 원문이라 `<` `&` 가 섞이면 링크·서식으로 해석된다.
    .map((posting) => escapeSlackMrkdwn(`${posting.company} ${posting.title}`));
  const rest = postings.length - names.length;
  return rest > 0 ? `${names.join(' · ')} 외 ${rest}` : names.join(' · ');
};

export const formatMorningDigest = (input: MorningDigestInput): string => {
  const postings = input.postings ?? [];
  const todo: string[] = [];
  if (input.approvalLabels.length > 0) {
    todo.push(
      `• 승인 대기 ${input.approvalLabels.length}장 — ${escapeSlackMrkdwn(countByLabel(input.approvalLabels))}`,
    );
  }
  for (const incident of input.incidents) {
    todo.push(
      `• 🔴 장애  ${escapeSlackMrkdwn(incident.label)} · ${incident.dayCount}일째`,
    );
  }
  if (postings.length > 0) {
    todo.push(
      `• 공고 ${postings.length}건 — ${formatPostingNames(postings)} · 지원할지? (목록은 스레드)`,
    );
  }

  const kinds = [
    input.approvalLabels.length > 0
      ? `승인 ${input.approvalLabels.length}`
      : null,
    input.incidents.length > 0 ? `장애 ${input.incidents.length}` : null,
    postings.length > 0 ? `공고 ${postings.length}` : null,
  ].filter((kind): kind is string => kind !== null);
  const totalCount =
    input.approvalLabels.length + input.incidents.length + postings.length;
  const day = formatTradeDay(input.firedAtKst);
  const header =
    totalCount === 0
      ? `☀️ *${day} 아침* — 손댈 것 없음`
      : `☀️ *${day} 아침* — 할 일 ${totalCount} · ${kinds.join(' · ')}`;

  const rest: string[] = [];
  if (input.invest) {
    rest.push(
      `• 투자  오늘 시가 매수 ${input.invest.buyCount} · 매도 ${input.invest.sellCount} 예정`,
    );
  }
  if (input.company) {
    rest.push(
      `• 회사  먼저 이것부터 — ${link(input.company.title, input.company.url)}`,
    );
  }
  if (input.study) {
    rest.push(
      `• 공부  ${link(input.study.topic, input.study.url)} · ${STUDY_MINUTES}분`,
    );
  }
  if (input.portfolio) {
    rest.push(`• 포트폴리오  어제 ${escapeSlackMrkdwn(input.portfolio)}`);
  }
  if (input.postings !== null && input.stalePostingCollection) {
    const { lastCollectedOn } = input.stalePostingCollection;
    rest.push(
      lastCollectedOn
        ? `• 공고  ⚠️ 마지막 수집 ${formatTradeDay(lastCollectedOn)} — 수집이 멈춘 것 같습니다`
        : '• 공고  ⚠️ 수집된 적이 없습니다 — 수집 설정을 확인하세요',
    );
  }

  return [
    header,
    ...(todo.length > 0 ? ['', '✋ *할 일*', ...todo] : []),
    ...(rest.length > 0 ? ['', '*어제 · 오늘*', ...rest] : []),
  ].join('\n');
};
