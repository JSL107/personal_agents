import { PreferenceDiff } from '../../preference-profile/domain/preference-profile.type';

// PreferenceProposal diff 를 Slack mrkdwn 승인 카드 본문으로. add(+)/remove(-) 를 섹션별로.
export const formatPreferenceProposal = (
  diff: PreferenceDiff,
  rationale: string,
): string => {
  const lines: string[] = ['*선호 프로필 갱신 제안*', ''];
  const listSection = (
    label: string,
    section?: { add?: string[]; remove?: string[] },
  ): void => {
    if (!section) {
      return;
    }
    for (const item of section.add ?? []) {
      lines.push(`• +${label}: ${item}`);
    }
    for (const item of section.remove ?? []) {
      lines.push(`• -${label}: ${item}`);
    }
  };
  listSection('문체', diff.tone);
  listSection('우선순위', diff.priorities);
  listSection('금지', diff.doNot);
  if (diff.verbosity) {
    for (const [key, value] of Object.entries(diff.verbosity)) {
      lines.push(`• 분량(${key}): ${value}`);
    }
  }
  if (diff.routingHints?.add?.length) {
    for (const hint of diff.routingHints.add) {
      lines.push(`• +지칭: "${hint.phrase}" → ${hint.intent}`);
    }
  }
  lines.push('', `_근거: ${rationale}_`);
  return lines.join('\n');
};
