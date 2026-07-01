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

// 섹션별 짧은 프롬프트 블록. 렌더할 내용이 없으면 '' 반환(동작 변화 0).
export const renderInjectionBlock = (
  profile: PreferenceProfile,
  section: PreferenceSection,
): string => {
  let lines: string[] = [];
  if (section === 'briefing') {
    lines = styleLines(profile, profile.verbosity.briefing);
  } else if (section === 'humanize') {
    lines = styleLines(profile, profile.verbosity.humanize);
  } else {
    lines = profile.routingHints.map(
      (hint) => `- "${hint.phrase}" → ${hint.intent}`,
    );
  }
  if (lines.length === 0) {
    return '';
  }
  const header =
    section === 'routing' ? '사용자 지칭 습관 힌트:' : '사용자 문체 선호:';
  return `${header}\n${lines.join('\n')}`;
};
