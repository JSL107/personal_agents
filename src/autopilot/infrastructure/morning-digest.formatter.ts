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
  // 사건 원장(alert_incident)에서 온 장애만 며칠째인지 안다. 그날 회차에서 감지한 문제
  // (계획 생성 실패·공고 수집 정지·포트폴리오 발행 실패)는 null 이라 일수를 적지 않는다.
  dayCount: number | null;
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

// 회사명만 적는다. 공고 제목은 "…의 새로운 기준을 만들 [백엔드 테크리드] 찾습니다" 처럼 길어
// 두 건만 붙여도 한 줄이 두세 줄로 넘친다 — 제목은 스레드 목록에 있다.
const formatPostingNames = (postings: MorningPosting[]): string => {
  const companies = [...new Set(postings.map((posting) => posting.company))];
  const names = companies
    .slice(0, MAX_POSTING_NAMES)
    // 회사명은 채용 사이트 원문이라 `<` `&` 가 섞이면 링크·서식으로 해석된다.
    .map(escapeSlackMrkdwn);
  // "외 N" 은 이름을 못 적은 **회사** 수다. 공고 수로 세면 한 회사의 공고 2건이 "A사 외 1" 로 나가
  // 다른 회사가 더 있는 것처럼 읽힌다 — 공고 수는 앞의 "공고 N건" 이 이미 말한다.
  const rest = companies.length - names.length;
  return rest > 0 ? `${names.join(' · ')} 외 ${rest}` : names.join(' · ');
};

export const formatMorningDigest = (input: MorningDigestInput): string => {
  const postings = input.postings ?? [];
  const todo: string[] = [];
  if (input.approvalLabels.length > 0) {
    todo.push(
      `• *승인 대기 ${input.approvalLabels.length}장* — ${escapeSlackMrkdwn(countByLabel(input.approvalLabels))}`,
    );
  }
  for (const incident of input.incidents) {
    const days =
      incident.dayCount === null ? '' : ` · ${incident.dayCount}일째`;
    todo.push(`• 🔴 *장애* — ${escapeSlackMrkdwn(incident.label)}${days}`);
  }
  if (postings.length > 0) {
    todo.push(
      `• *공고 ${postings.length}건* — ${formatPostingNames(postings)} (목록은 스레드)`,
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
  // 종류가 하나뿐이면 "할 일 10 · 공고 10" 처럼 같은 숫자가 두 번 보인다 — 종류만 적는다.
  const header =
    totalCount === 0
      ? `☀️ *${day} 아침* — 손댈 것 없음`
      : kinds.length === 1
        ? `☀️ *${day} 아침* — ${kinds[0]}`
        : `☀️ *${day} 아침* — 할 일 ${totalCount} (${kinds.join(' · ')})`;

  const rest: string[] = [];
  if (input.invest) {
    rest.push(
      `• *투자* — 오늘 시가 매수 ${input.invest.buyCount} · 매도 ${input.invest.sellCount} 예정`,
    );
  }
  if (input.company) {
    rest.push(
      `• *회사 1순위* — ${link(input.company.title, input.company.url)}`,
    );
  }
  if (input.study) {
    rest.push(
      `• *공부* — ${link(input.study.topic, input.study.url)} · ${STUDY_MINUTES}분`,
    );
  }
  if (input.portfolio) {
    rest.push(`• *포트폴리오* — 어제 ${escapeSlackMrkdwn(input.portfolio)}`);
  }

  // 소제목은 `*…*` 만 있는 줄이어야 공통 렌더(message-blocks.builder)가 제목 블록 + 구분선으로 올린다.
  // 앞에 이모지를 붙이면 한 소제목만 본문 글씨로 남아 두 소제목의 크기가 달라진다.
  return [
    header,
    ...(todo.length > 0 ? ['', '*할 일*', ...todo] : []),
    ...(rest.length > 0 ? ['', '*어제 · 오늘*', ...rest] : []),
  ].join('\n');
};
