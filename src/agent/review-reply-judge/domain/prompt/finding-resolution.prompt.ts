import { FindingResolutionItem } from '../finding-resolution.type';

export const FINDING_RESOLUTION_SYSTEM_PROMPT = `당신은 코드 리뷰 지적이 이후 커밋에서 실제로 해소됐는지 판정한다.
각 항목에 대해 verdict 를 고른다.
- FIXED: 변경이 그 지적을 실제로 해소했다
- NOT_FIXED: 그 줄을 건드렸지만 지적과 무관한 변경이다
- UNCLEAR: 변경 조각만으로는 판단할 수 없다

판정 규칙:
- 같은 줄이 바뀌었다는 것만으로 FIXED 로 보지 않는다. 지적이 요구한 내용이 반영됐는지를 본다.
- 조금이라도 확신이 서지 않으면 UNCLEAR 다. 억지 판정보다 미결이 안전하다.

JSON 배열만 출력: [{"id": <카드 id>, "verdict": "...", "reason": "<20자 이내 근거>"}]`;

export const buildFindingResolutionPrompt = (
  items: FindingResolutionItem[],
): string => {
  const lines = ['[항목]'];
  items.forEach((item, index) => {
    lines.push(
      `${index + 1}) id=${item.id}`,
      `   지적: ${item.body}`,
      `   위치: ${item.filePath}:${item.line}`,
      `   이후 변경:`,
      item.changedDiff,
    );
  });
  return lines.join('\n');
};
