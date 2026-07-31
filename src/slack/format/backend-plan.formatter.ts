import { BackendPlan } from '../../agent/be/domain/be-agent.type';
import { escapeSlackMrkdwn } from './mrkdwn.util';

// /plan-task 결과 — BackendPlan 을 한국어 Slack 마크다운으로 렌더.
// LLM 자유텍스트 필드는 escapeSlackMrkdwn 으로 제어문자(<>&) escape — Slack 이 `<...>` 를
// 링크 태그로, `&...;` 를 엔티티로 오인해 텍스트가 잘리는 렌더 위조를 막는다.
// 단 api.method/path 는 인라인 코드(백틱) 안이라 escape 하지 않는다(백틱 내부는 리터럴 렌더 —
// escape 하면 `&lt;` 가 그대로 노출됨).
export const formatBackendPlan = (plan: BackendPlan): string => {
  const lines: string[] = [
    `*백엔드 구현 계획* — ${escapeSlackMrkdwn(plan.subject)}`,
    '',
    `📌 *컨텍스트*: ${escapeSlackMrkdwn(plan.context)}`,
    '',
    '*구현 체크리스트*',
    ...plan.implementationChecklist.flatMap((item) => {
      const dep =
        item.dependsOn.length > 0
          ? ` _(선행: ${escapeSlackMrkdwn(item.dependsOn.join(', '))})_`
          : '';
      return [
        `• *${escapeSlackMrkdwn(item.title)}*${dep}`,
        `   ↳ ${escapeSlackMrkdwn(item.description)}`,
      ];
    }),
    '',
  ];

  if (plan.apiDesign && plan.apiDesign.length > 0) {
    lines.push('*API 설계*');
    for (const api of plan.apiDesign) {
      lines.push(`• \`${api.method} ${api.path}\``);
      lines.push(`   req: ${escapeSlackMrkdwn(api.request)}`);
      lines.push(`   res: ${escapeSlackMrkdwn(api.response)}`);
      if (api.notes.length > 0) {
        lines.push(`   📝 ${escapeSlackMrkdwn(api.notes)}`);
      }
    }
    lines.push('');
  }

  if (plan.risks.length > 0) {
    lines.push(
      '*리스크*',
      ...plan.risks.map((r) => `• ${escapeSlackMrkdwn(r)}`),
      '',
    );
  }

  if (plan.testPoints.length > 0) {
    lines.push(
      '*테스트 포인트*',
      ...plan.testPoints.map((t) => `• ${escapeSlackMrkdwn(t)}`),
      '',
    );
  }

  lines.push(
    `*예상 소요*: ${plan.estimatedHours}시간`,
    '',
    `*판단 근거*: ${escapeSlackMrkdwn(plan.reasoning)}`,
  );

  return lines.join('\n');
};
