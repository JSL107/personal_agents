import { SreAnalysis } from '../../agent/be-sre/domain/be-sre.type';

const PATCH_LINES_CAP = 200;
const FILES_DISPLAY_LIMIT = 10;

// /be-sre 응답 포매터.
// patchProposal 은 LLM 이 생성한 markdown 코드 fence 를 그대로 노출하되 <>&는 escape.
// rootCauseHypothesis / reasoning 은 자유 텍스트라 escape 적용 (mrkdwn 위조 차단).
export const formatSreAnalysis = (a: SreAnalysis): string => {
  const lines: string[] = [];

  lines.push('*🚨 BE-SRE 분석*');
  lines.push('');

  if (a.parseError) {
    lines.push('⚠️ LLM 응답이 JSON 형식이 아니어서 원문을 그대로 표시합니다.');
    lines.push('');
  }

  if (a.rootCauseHypothesis.trim().length > 0) {
    lines.push('*근본 원인 가설*');
    lines.push(escapeSlackMrkdwn(a.rootCauseHypothesis.trim()));
    lines.push('');
  }

  if (a.affectedFiles.length > 0) {
    const head = a.affectedFiles.slice(0, FILES_DISPLAY_LIMIT);
    const remaining = a.affectedFiles.length - head.length;
    lines.push(`*영향 받는 파일 (${a.affectedFiles.length}개)*`);
    for (const file of head) {
      lines.push(`\`${escapeSlackMrkdwn(file)}\``);
    }
    if (remaining > 0) {
      lines.push(`_(${remaining}개 추가 생략)_`);
    }
    lines.push('');
  }

  if (a.patchProposal.trim().length > 0) {
    lines.push('*제안 Patch*');
    const patchLines = a.patchProposal.split('\n');
    const capped = patchLines.slice(0, PATCH_LINES_CAP);
    const omitted = patchLines.length - capped.length;
    // patchProposal 이 LLM 생성 markdown 이라 <>&만 escape 하고 fence 는 그대로 노출.
    lines.push(escapeSlackMrkdwn(capped.join('\n')));
    if (omitted > 0) {
      lines.push(`_(+${omitted}줄 생략)_`);
    }
    lines.push('');
  }

  if (a.reasoning.trim().length > 0) {
    lines.push(`_${escapeSlackMrkdwn(a.reasoning.trim())}_`);
  }

  return lines.join('\n');
};

// Slack mrkdwn control 문자 escape — LLM 출력에 의한 메시지 위조 차단.
const escapeSlackMrkdwn = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
