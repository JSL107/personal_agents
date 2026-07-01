import {
  PreferenceProfile,
  PreferenceSection,
  Verbosity,
} from './preference-profile.type';

const VERBOSITY_KO: Record<Verbosity, string> = {
  terse: '간결하게',
  balanced: '균형 있게',
  detailed: '상세하게',
};

const styleLines = (
  profile: PreferenceProfile,
  verbosity: Verbosity | undefined,
): string[] => {
  const lines: string[] = [];
  if (profile.tone.length > 0) {
    lines.push(`- 문체: ${profile.tone.join(', ')}`);
  }
  if (verbosity) {
    lines.push(`- 분량: ${verbosity} (${VERBOSITY_KO[verbosity]})`);
  }
  if (profile.doNot.length > 0) {
    lines.push(`- 금지: ${profile.doNot.join('; ')}`);
  }
  return lines;
};

const HEADERS: Record<PreferenceSection, string> = {
  briefing: '사용자 문체 선호:',
  humanize: '사용자 문체 선호:',
  plan: '사용자 업무 선호:',
  routing: '사용자 지칭 습관 힌트:',
};

// 섹션별 렌더 라인 구성.
//  - briefing/humanize: 문체(tone/분량/금지) — styleLines.
//  - plan: 업무 계획 선호 — 우선순위(planning 의 핵심)를 먼저, 이어서 문체(plan 분량).
//  - routing: 지칭 습관 힌트.
const sectionLines = (
  profile: PreferenceProfile,
  section: PreferenceSection,
): string[] => {
  if (section === 'routing') {
    return profile.routingHints.map(
      (hint) => `- "${hint.phrase}" → ${hint.intent}`,
    );
  }
  if (section === 'plan') {
    const lines: string[] = [];
    if (profile.priorities.length > 0) {
      lines.push(`- 우선순위: ${profile.priorities.join(', ')}`);
    }
    lines.push(...styleLines(profile, profile.verbosity.plan));
    return lines;
  }
  const verbosity =
    section === 'briefing'
      ? profile.verbosity.briefing
      : profile.verbosity.humanize;
  return styleLines(profile, verbosity);
};

// 섹션별 짧은 프롬프트 블록. 렌더할 내용이 없으면 '' 반환(동작 변화 0).
export const renderInjectionBlock = (
  profile: PreferenceProfile,
  section: PreferenceSection,
): string => {
  const lines = sectionLines(profile, section);
  if (lines.length === 0) {
    return '';
  }
  return `${HEADERS[section]}\n${lines.join('\n')}`;
};
