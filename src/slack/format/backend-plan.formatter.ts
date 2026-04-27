import { BackendPlan } from '../../agent/be/domain/be-agent.type';

// /plan-task 결과 — BackendPlan 을 한국어 Slack 마크다운으로 렌더.
export const formatBackendPlan = (plan: BackendPlan): string => {
  const lines: string[] = [
    `*백엔드 구현 계획* — ${plan.subject}`,
    '',
    `📌 *컨텍스트*: ${plan.context}`,
    '',
    '*구현 체크리스트*',
    ...plan.implementationChecklist.flatMap((item) => {
      const dep =
        item.dependsOn.length > 0
          ? ` _(선행: ${item.dependsOn.join(', ')})_`
          : '';
      return [`• *${item.title}*${dep}`, `   ↳ ${item.description}`];
    }),
    '',
  ];

  if (plan.apiDesign && plan.apiDesign.length > 0) {
    lines.push('*API 설계*');
    for (const api of plan.apiDesign) {
      lines.push(`• \`${api.method} ${api.path}\``);
      lines.push(`   req: ${api.request}`);
      lines.push(`   res: ${api.response}`);
      if (api.notes.length > 0) {
        lines.push(`   📝 ${api.notes}`);
      }
    }
    lines.push('');
  }

  if (plan.risks.length > 0) {
    lines.push('*리스크*', ...plan.risks.map((r) => `• ${r}`), '');
  }

  if (plan.testPoints.length > 0) {
    lines.push('*테스트 포인트*', ...plan.testPoints.map((t) => `• ${t}`), '');
  }

  lines.push(
    `*예상 소요*: ${plan.estimatedHours}시간`,
    '',
    `*판단 근거*: ${plan.reasoning}`,
  );

  return lines.join('\n');
};
