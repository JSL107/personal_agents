import { PoOutline } from '../../agent/po-expand/domain/po-expand.type';

// /po-expand 와 /retry-run 의 PO_EXPAND case 가 동일 포맷을 공유. 인라인 중복을 제거.
export const formatPoOutline = (outline: PoOutline): string => {
  const lines: string[] = [
    `*📋 ${outline.subject} — 개요*`,
    '',
    outline.outline.map((line) => `• ${line}`).join('\n'),
  ];
  if (outline.clarifyingQuestions.length > 0) {
    lines.push('', '*명확화 질문:*');
    outline.clarifyingQuestions.forEach((question) => {
      lines.push(`• ${question}`);
    });
  }
  if (outline.parseError) {
    lines.push(
      '',
      '_(⚠️ 모델 응답 JSON 파싱 실패 — 원문을 outline 으로 보존)_',
    );
  }
  return lines.join('\n');
};
