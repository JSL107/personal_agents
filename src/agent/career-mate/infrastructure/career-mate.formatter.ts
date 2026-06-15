import { NotionPlanBlock } from '../../../notion/domain/port/notion-client.port';
import { CareerProfileData } from '../domain/career-mate.type';

export const formatProfileSummary = (data: CareerProfileData): string => {
  const top = data.accomplishments
    .slice(0, 3)
    .map((a) => `• ${a.bullet}`)
    .join('\n');
  return [
    `*역량 프로필 갱신 완료* ✅`,
    `스킬 ${data.skills.length} · 성과 ${data.accomplishments.length} · 증거 PR ${data.meta.prCount}건`,
    ``,
    data.summary,
    top ? `\n*상위 성과*\n${top}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};

export const formatResume = (data: CareerProfileData): string => {
  const bullets = data.accomplishments.map((a) => `• ${a.bullet}`).join('\n');
  const skills = data.skills.map((s) => s.name).join(', ');
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

export const buildPortfolioBlocks = (
  data: CareerProfileData,
): NotionPlanBlock[] => {
  const blocks: NotionPlanBlock[] = [
    { type: 'heading', text: '역량 요약' },
    { type: 'paragraph', text: data.summary },
    { type: 'divider' },
    { type: 'heading', text: '핵심 성과' },
  ];
  for (const a of data.accomplishments) {
    blocks.push({ type: 'subheading', text: a.title });
    blocks.push({ type: 'bullet', text: a.bullet });
    for (const e of a.evidence) {
      blocks.push({
        type: 'bullet',
        text: `근거: ${e.repo}#${e.pr}`,
        link: e.url,
      });
    }
  }
  blocks.push({ type: 'divider' });
  blocks.push({ type: 'heading', text: '기술 스택' });
  for (const s of data.skills) {
    blocks.push({
      type: 'bullet',
      text: `${s.name} (${s.category} · ${s.proficiency})`,
    });
  }
  return blocks;
};
