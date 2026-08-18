import { NotionPlanBlock } from '../../../notion/domain/port/notion-client.port';
import {
  CalibrationResultData,
  CareerProfileData,
  GapAnalysisData,
  ProfileAccomplishment,
  ReflectPrResult,
  ResumeAuditResult,
} from '../domain/career-mate.type';

const bulletList = (items: string[]): string[] =>
  items.map((item) => `• ${escapeSlackMrkdwn(item)}`);

export const formatProfileSummary = (data: CareerProfileData): string => {
  const top = data.accomplishments
    .slice(0, 3)
    .map((a) => `• ${escapeSlackMrkdwn(a.bullet)}`)
    .join('\n');
  return [
    `*역량 프로필 갱신 완료* ✅`,
    `스킬 ${data.skills.length} · 성과 ${data.accomplishments.length} · 증거 PR ${data.meta.prCount}건`,
    ``,
    escapeSlackMrkdwn(data.summary),
    top ? `\n*상위 성과*\n${top}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};

export const formatResume = (data: CareerProfileData): string => {
  const bullets = data.accomplishments
    .map((a) => `• ${escapeSlackMrkdwn(a.bullet)}`)
    .join('\n');
  const skills = data.skills.map((s) => escapeSlackMrkdwn(s.name)).join(', ');
  return [
    `*이력서 — 성과*`,
    bullets || '(성과 없음)',
    ``,
    `*기술 스택*`,
    skills || '(스킬 없음)',
  ].join('\n');
};

export const formatPortfolioLink = ({ url }: { url: string }): string =>
  `*포트폴리오 페이지 갱신 완료* ✅\n${url}`;

export const formatUnknownCareerMate = (): string =>
  '무엇을 도와드릴까요? "프로필 정리해줘" / "이력서 뽑아줘" / "포트폴리오 정리" 중에 말씀해주세요.';

export const formatGapReport = (data: GapAnalysisData): string => {
  const have = data.have.map((h) => `• ${escapeSlackMrkdwn(h)}`).join('\n');
  const gaps = data.gaps.map((g) => `• ${escapeSlackMrkdwn(g)}`).join('\n');
  const topics = data.topics
    .map(
      (t, i) =>
        `${i + 1}. ${escapeSlackMrkdwn(t.title)} — _${escapeSlackMrkdwn(t.rationale)}_`,
    )
    .join('\n');
  return [
    `*JD 갭 분석*`,
    escapeSlackMrkdwn(data.fitSummary),
    ``,
    `*보유*\n${have || '(없음)'}`,
    `*갭*\n${gaps || '(없음)'}`,
    ``,
    `*갭을 메우는 블로그 주제*\n${topics}`,
    ``,
    `원하는 주제 번호를 말해주세요 (예: "2번"). 취소하려면 "아니".`,
  ].join('\n');
};

// 요약 렌더 시 섹션당 노출 불릿 상한. 초과분은 "…외 N개" 로 접고 full(스레드)에서 전부 보여준다.
const CALIBRATION_SUMMARY_LIMIT = 3;

// 이력서 보정 점검 섹션 정의 — 라벨 + 데이터 추출자. summary/full 이 같은 순서·라벨을 공유한다.
const CALIBRATION_SECTIONS: ReadonlyArray<{
  title: string;
  pick: (data: CalibrationResultData) => string[];
}> = [
  { title: '🤖 AI-slop 위험', pick: (data) => data.aiSlopRisks },
  { title: '📊 정량 보강 필요', pick: (data) => data.underQuantified },
  { title: '🕰️ 구식 표현', pick: (data) => data.outdatedPhrasing },
  { title: '🔑 빠진 키워드', pick: (data) => data.missingKeywords },
  { title: '✅ 액션', pick: (data) => data.actionItems },
];

// formatCalibrationReport 반환 — Slack 벽 방지용 요약/전체 분리.
export interface CalibrationRender {
  // 섹션별 top N + 초과 표시. 비요청 주간 cron 메인 메시지용.
  summary: string;
  // 전체 리포트. slash 응답(사용자 요청) / cron 스레드 상세용.
  full: string;
  // summary 가 일부 항목을 접었는지 — cron 이 스레드 상세를 붙일지 판단.
  truncated: boolean;
}

// 이력서 보정 점검을 요약/전체로 렌더. 43불릿 통짜 발송을 막기 위해 요약은 섹션당 상한을 둔다.
export const formatCalibrationReport = (
  data: CalibrationResultData,
): CalibrationRender => {
  const sections = CALIBRATION_SECTIONS.map((section) => ({
    title: section.title,
    items: section.pick(data),
  }));
  const truncated = sections.some(
    (section) => section.items.length > CALIBRATION_SUMMARY_LIMIT,
  );

  const summarySection = (title: string, items: string[]): string => {
    if (items.length === 0) {
      return '';
    }
    const lines = bulletList(items.slice(0, CALIBRATION_SUMMARY_LIMIT));
    const rest = items.length - CALIBRATION_SUMMARY_LIMIT;
    if (rest > 0) {
      lines.push(`• _…외 ${rest}개는 스레드 참고_`);
    }
    return `*${title}*\n${lines.join('\n')}`;
  };

  const fullSection = (title: string, items: string[]): string => {
    if (items.length === 0) {
      return '';
    }
    return `*${title}*\n${bulletList(items).join('\n')}`;
  };

  const header = [`*이력서 보정 점검*`, escapeSlackMrkdwn(data.verdict)];

  const summary = [
    ...header,
    ...sections.map((section) => summarySection(section.title, section.items)),
  ]
    .filter((line) => line.length > 0)
    .join('\n\n');

  const full = [
    ...header,
    ...sections.map((section) => fullSection(section.title, section.items)),
  ]
    .filter((line) => line.length > 0)
    .join('\n\n');

  return { summary, full, truncated };
};

export interface ResumeAuditRender {
  summary: string;
  full: string;
}

const AUDIT_STATUS_LABEL: Record<
  ResumeAuditResult['items'][number]['status'],
  string
> = {
  PROVEN: '입증',
  WEAK: '약함',
  MISSING: '근거없음',
  UNJUDGED: '미판정',
};

export const formatResumeAudit = (
  result: ResumeAuditResult,
): ResumeAuditRender => {
  const weakCount = result.items.filter(
    (item) => item.status === 'WEAK',
  ).length;
  const missingCount = result.items.filter(
    (item) => item.status === 'MISSING',
  ).length;
  // 모델 총평은 가드가 강등·강제하기 전 판정을 근거로 쓰인다. 가드가 개입한 회차에 총평만
  // 첫 화면에 두면 "모두 입증됐다" 같은 문장이 강등된 판정과 나란히 뜬다. 총평을 코드가 다시
  // 쓰지는 않는다 — 그러면 "무엇이 부족한가"라는 질적 내용을 잃고 위 카운트만 남는다.
  // 대신 개입 사실을 총평 바로 아래에 밝힌다.
  const guardTouched =
    result.guard.demotedTitles.length +
    result.guard.forcedMissing.length +
    result.guard.droppedTitles.length +
    result.guard.unjudgedTitles.length;
  const summary = [
    `*이력서 증거력 감사*`,
    `약함 ${weakCount}건 / 근거없음 ${missingCount}건 (총 ${result.items.length}건)`,
    escapeSlackMrkdwn(result.verdict),
    guardTouched > 0
      ? `_위 총평은 모델이 가드 개입 전에 쓴 것입니다 — 가드가 ${guardTouched}건을 조정했으니 항목별 판정을 기준으로 보세요._`
      : '',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
  const itemLines = result.items.flatMap((item) => {
    const lines = [
      `• *[${AUDIT_STATUS_LABEL[item.status]}] ${escapeSlackMrkdwn(item.title)}* — ${escapeSlackMrkdwn(item.why)}`,
    ];
    if (item.rewrite) {
      lines.push(
        `  ${escapeSlackMrkdwn(item.rewrite.before)} → ${escapeSlackMrkdwn(item.rewrite.after)} _(${item.rewrite.frame})_`,
      );
    }
    return lines;
  });
  const jdLines = result.jdFindings.map(
    (finding) =>
      `• [${finding.priority}/${AUDIT_STATUS_LABEL[finding.status]}] ${escapeSlackMrkdwn(finding.requirement)} — ${escapeSlackMrkdwn(finding.why)}`,
  );
  const riskLines = result.rejectionRisks.map((risk) => {
    const rebuttal = risk.rebuttal
      ? ` — 반박: ${escapeSlackMrkdwn(risk.rebuttal)}`
      : '';
    return `• ${escapeSlackMrkdwn(risk.reason)}${rebuttal}`;
  });
  const guardLine = `강등 ${result.guard.demotedTitles.length} / 폐기 ${result.guard.droppedTitles.length} / 누락 ${result.guard.unjudgedTitles.length} / 근거없음 강제 ${result.guard.forcedMissing.length}`;
  // 약하다고 판정하고 고칠 문장을 주지 않은 항목 — 사용자가 무엇을 고칠지 못 받은 자리다.
  const rewriteMissingLine =
    result.guard.rewriteMissing.length > 0
      ? `*고칠 문장 누락* ${result.guard.rewriteMissing.length}건 — ${result.guard.rewriteMissing.map((title) => escapeSlackMrkdwn(title)).join(', ')}`
      : '';
  const source = result.jdSource
    ? `*목표 공고* ${escapeSlackMrkdwn(result.jdSource.company)} / ${escapeSlackMrkdwn(result.jdSource.role)}`
    : '';
  const full = [
    summary,
    itemLines.length > 0 ? `*항목별 판정*\n${itemLines.join('\n')}` : '',
    source,
    jdLines.length > 0 ? `*공고 대조*\n${jdLines.join('\n')}` : '',
    riskLines.length > 0 ? `*탈락 위험*\n${riskLines.join('\n')}` : '',
    rewriteMissingLine,
    `*가드 결과* ${guardLine}`,
  ]
    .filter((line) => line.length > 0)
    .join('\n\n');
  return { summary, full };
};

// accomplishment 의 evidence 중 최빈 repo 를 대표 프로젝트로. 동률이면 첫 evidence 의 repo.
// evidence 없으면 '기타'.
const primaryRepo = (accomplishment: ProfileAccomplishment): string => {
  if (accomplishment.evidence.length === 0) {
    return '기타';
  }
  const counts = new Map<string, number>();
  for (const evidence of accomplishment.evidence) {
    counts.set(evidence.repo, (counts.get(evidence.repo) ?? 0) + 1);
  }
  let top = accomplishment.evidence[0].repo;
  let topCount = 0;
  for (const [repo, count] of counts) {
    if (count > topCount) {
      top = repo;
      topCount = count;
    }
  }
  return top;
};

export const buildPortfolioBlocks = (
  data: CareerProfileData,
): NotionPlanBlock[] => {
  const blocks: NotionPlanBlock[] = [
    { type: 'heading', text: '역량 요약' },
    { type: 'paragraph', text: data.summary },
    { type: 'divider' },
  ];

  // 대표 repo(프로젝트) 별로 성과 그룹핑 — Map 삽입 순서 = 최초 등장 프로젝트 순.
  const groups = new Map<string, ProfileAccomplishment[]>();
  for (const accomplishment of data.accomplishments) {
    const repo = primaryRepo(accomplishment);
    const list = groups.get(repo) ?? [];
    list.push(accomplishment);
    groups.set(repo, list);
  }

  for (const [repo, accomplishments] of groups) {
    blocks.push({ type: 'heading', text: `프로젝트: ${repo}` });
    for (const accomplishment of accomplishments) {
      blocks.push({ type: 'subheading', text: accomplishment.title });
      blocks.push({ type: 'bullet', text: accomplishment.bullet });
      for (const evidence of accomplishment.evidence) {
        blocks.push({
          type: 'bullet',
          text: `근거: ${evidence.repo}#${evidence.pr}`,
          link: evidence.url,
        });
      }
    }
  }

  blocks.push({ type: 'divider' });
  blocks.push({ type: 'heading', text: '기술 스택' });
  for (const skill of data.skills) {
    blocks.push({
      type: 'bullet',
      text: `${skill.name} (${skill.category} · ${skill.proficiency})`,
    });
  }
  return blocks;
};

// 이력서 Notion 미러용 — 성과 bullet + 기술 스택 (압축). STAR/근거는 포트폴리오 몫이라 제외.
export const buildResumeBlocks = (
  data: CareerProfileData,
): NotionPlanBlock[] => {
  const blocks: NotionPlanBlock[] = [
    { type: 'heading', text: '역량 요약' },
    { type: 'paragraph', text: data.summary },
    { type: 'divider' },
    { type: 'heading', text: '성과' },
  ];
  for (const accomplishment of data.accomplishments) {
    blocks.push({ type: 'bullet', text: accomplishment.bullet });
  }
  blocks.push({ type: 'divider' });
  blocks.push({ type: 'heading', text: '기술 스택' });
  for (const skill of data.skills) {
    blocks.push({
      type: 'bullet',
      text: `${skill.name} (${skill.category} · ${skill.proficiency})`,
    });
  }
  return blocks;
};

// REFLECT_PR — PR 회고 결과를 Slack mrkdwn 으로. 반영한 PR 목록 + 회고 서술 + 이력서 bullet(STAR) + 포폴 링크.
export const formatPrRetro = (result: ReflectPrResult): string => {
  const a = result.accomplishment;
  const star = a.star;
  const prList = a.evidence.map((e) => `${e.repo}#${e.pr}`).join(', ');
  return [
    `*PR 회고 — ${escapeSlackMrkdwn(a.title)}*`,
    `_반영한 PR: ${escapeSlackMrkdwn(prList)}_`,
    escapeSlackMrkdwn(result.narrative),
    ``,
    `*이력서 bullet*`,
    `• ${escapeSlackMrkdwn(a.bullet)}`,
    ``,
    `*STAR*`,
    `• S: ${escapeSlackMrkdwn(star.situation)}`,
    `• T: ${escapeSlackMrkdwn(star.task)}`,
    `• A: ${escapeSlackMrkdwn(star.action)}`,
    `• R: ${escapeSlackMrkdwn(star.result)}`,
    ``,
    `*포트폴리오 반영 완료* ✅\n${result.portfolioUrl}`,
  ].join('\n');
};

// Slack mrkdwn control 문자 escape — LLM 출력(summary/bullet/skill명)에 의한 메시지 위조 차단.
// (Notion 미러 경로는 어댑터가 link 를 isSafeHttpUrl 로 가드하므로 Slack mrkdwn 한정.)
const escapeSlackMrkdwn = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
