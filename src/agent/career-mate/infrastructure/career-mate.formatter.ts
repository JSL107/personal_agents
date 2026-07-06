import { NotionPlanBlock } from '../../../notion/domain/port/notion-client.port';
import {
  CalibrationResultData,
  CareerProfileData,
  GapAnalysisData,
  ProfileAccomplishment,
  ReflectPrResult,
} from '../domain/career-mate.type';

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

export const formatCalibrationReport = (
  data: CalibrationResultData,
): string => {
  const section = (title: string, items: string[]): string =>
    items.length === 0
      ? ''
      : `*${title}*\n${items.map((i) => `• ${escapeSlackMrkdwn(i)}`).join('\n')}`;
  return [
    `*이력서 보정 점검*`,
    escapeSlackMrkdwn(data.verdict),
    ``,
    section('🤖 AI-slop 위험', data.aiSlopRisks),
    section('📊 정량 보강 필요', data.underQuantified),
    section('🕰️ 구식 표현', data.outdatedPhrasing),
    section('🔑 빠진 키워드', data.missingKeywords),
    section('✅ 액션', data.actionItems),
  ]
    .filter((line) => line.length > 0)
    .join('\n\n');
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
