import type {
  MorningTodoLine,
  MorningTodoSections,
} from '../../schedule/application/build-morning-todos.usecase';
import {
  TODAY_TODO_BODY_MAX,
  WAITING_BODY_MAX,
} from '../../schedule/domain/daily-todo.constant';
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

export interface MorningTodo {
  title: string;
  url: string | null;
  dayCount: number | null;
}

export interface MorningDigestInput {
  firedAtKst: string;
  // 열린 승인 카드의 짧은 이름(카드마다 하나). 같은 이름이 여럿이면 묶어 센다.
  approvalLabels: string[];
  incidents: MorningIncident[];
  // 지난 아침 이후 닫힌 사건의 이름. 해결 DM 을 보내지 않으므로 여기가 해결을 알리는 유일한 자리다.
  resolvedIncidents: string[];
  // null = 공고 수집이 꺼져 있다(줄 자체를 내지 않는다). [] = 켜져 있으나 새 공고 없음.
  postings: MorningPosting[] | null;
  invest: { buyCount: number; sellCount: number } | null;
  // PM 계획의 최우선 1건. 회사 일의 "먼저 이것부터" 출처는 이것 하나다(§5 결정 갱신).
  todos: MorningTodo[] | null;
  todoSections: MorningTodoSections;
  planFailure: string | null;
  schedules: string[] | null;
  upcomingSchedules: string[] | null;
  // 기한 없는 진행 중·새 후보 줄(캘린더 업무 트래킹). 없으면 빈 배열.
  tracking: string[];
  asset: string | null;
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

export const formatMorningTodo = (todo: MorningTodoLine): string => {
  const parts = [
    ...(todo.dayCount >= 2 ? [`${todo.dayCount}일째`] : []),
    ...(todo.detail ? [escapeSlackMrkdwn(todo.detail)] : []),
  ];
  return `• ${link(todo.title, todo.url)}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`;
};

export const formatMorningWaitingTodo = (todo: MorningTodoLine): string =>
  `• ${link(todo.title, todo.url)}${todo.detail ? ` (${escapeSlackMrkdwn(todo.detail)})` : ''}`;

export const formatMorningDigest = (input: MorningDigestInput): string => {
  const incidentLabels = [
    ...(input.todos === null ? ['오늘 계획 생성 실패'] : []),
    ...input.incidents.map((incident) => incident.label),
  ];
  const kinds: string[] = [];
  if (incidentLabels.length) {
    const count = incidentLabels.length;
    const first = escapeSlackMrkdwn(incidentLabels[0]);
    kinds.push(
      count === 1
        ? `🔴 장애: ${first}`
        : `🔴 장애 ${count}: ${first} 외 ${count - 1}`,
    );
  }
  if (input.approvalLabels.length) {
    const count = input.approvalLabels.length;
    kinds.push(
      kinds.length === 0
        ? `✋ 승인 ${count} (${escapeSlackMrkdwn(countByLabel(input.approvalLabels))})`
        : `✋ 승인 ${count}`,
    );
  }
  if (input.postings?.length) {
    kinds.push(
      kinds.length === 0
        ? `공고 ${input.postings.length}: ${formatPostingNames(input.postings)}`
        : `공고 ${input.postings.length}`,
    );
  }
  const header = `☀️ *${formatTradeDay(input.firedAtKst)} 아침*${kinds.length ? ` · ${kinds.join(' · ')}` : ''}`;
  const todoSections = input.todoSections;
  const todos = todoSections.loadFailed
    ? ['• 오늘 할 일을 불러오지 못했어요']
    : [
        ...(todoSections.today.length === 0
          ? ['• 오늘 할 일이 없어요']
          : [
              ...todoSections.today
                .slice(0, TODAY_TODO_BODY_MAX)
                .map(formatMorningTodo),
              ...(todoSections.today.length > TODAY_TODO_BODY_MAX
                ? [`• 외 ${todoSections.today.length - TODAY_TODO_BODY_MAX}개`]
                : []),
            ]),
        ...(todoSections.unstarted.length > 0
          ? [
              `• 시작 안 한 일 ${todoSections.unstarted.length}개 (목록은 댓글에)`,
            ]
          : []),
      ];
  const waiting = todoSections.loadFailed
    ? []
    : [
        ...todoSections.waiting
          .slice(0, WAITING_BODY_MAX)
          .map(formatMorningWaitingTodo),
        ...(todoSections.waiting.length > WAITING_BODY_MAX
          ? [`• 외 ${todoSections.waiting.length - WAITING_BODY_MAX}개`]
          : []),
      ];
  const incidents = [
    ...(input.todos === null ? ['• 오늘 계획 생성 실패'] : []),
    ...input.incidents.map(
      (incident) =>
        `• ${escapeSlackMrkdwn(incident.label)}${incident.dayCount === null ? '' : ` (${incident.dayCount}일째)`}`,
    ),
    ...input.resolvedIncidents.map(
      (label) => `• ${escapeSlackMrkdwn(label)}, 지금은 복구됨`,
    ),
  ];
  const rest: string[] = input.tracking.map((line) => `• ${line}`);
  if (input.approvalLabels.length) {
    rest.push(
      `• 승인 대기 ${input.approvalLabels.length}장 (${escapeSlackMrkdwn(countByLabel(input.approvalLabels))})`,
    );
  }
  if (input.invest) {
    rest.push(
      `• 투자: 오늘 시가 매수 ${input.invest.buyCount}, 매도 ${input.invest.sellCount} 예정`,
    );
  }
  if (input.postings?.length) {
    rest.push(
      `• 새 공고 ${input.postings.length}건 (${formatPostingNames(input.postings)}), 목록은 댓글에`,
    );
  }
  if (input.study) {
    rest.push(
      `• 공부: ${link(input.study.topic, input.study.url)} ${STUDY_MINUTES}분`,
    );
  }
  if (input.portfolio) {
    rest.push(`• 포트폴리오: 어제 ${escapeSlackMrkdwn(input.portfolio)}`);
  }
  if (input.asset) {
    rest.push(`• 자산: ${input.asset}`);
  }
  const lines = [
    header,
    '',
    '*오늘 할 일*',
    ...todos,
    ...formatSection(
      `남 기다리는 일 ${todoSections.waiting.length}개`,
      waiting,
    ),
    ...formatSection('어제 장애', incidents),
    ...formatSection('오늘 일정', input.schedules ?? []),
    ...formatSection('다가오는 마감', input.upcomingSchedules ?? []),
    ...formatSection('그 밖에', rest),
  ];
  return lines.join('\n');
};

// 빈 칸은 소제목까지 통째로 그리지 않는다.
const formatSection = (title: string, lines: string[]): string[] =>
  lines.length > 0 ? ['', `*${title}*`, ...lines] : [];
