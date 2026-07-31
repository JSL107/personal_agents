import { ReviewReplyJudgeItem } from '../review-reply-judge.type';

export const REVIEW_REPLY_JUDGE_SYSTEM_PROMPT = `당신은 코드 리뷰 지적에 대한 작성자의 답변이 그 지적을 수용했는지 판정한다.
각 항목에 대해 verdict 를 고른다.
- ACCEPTED: 지적을 인정했거나 고쳤다고 답함
- REJECTED: 지적이 틀렸거나 불필요하다고 답함
- UNCLEAR: 질문·보류·판단 불가

JSON 배열만 출력: [{"id": <카드 id>, "verdict": "...", "reason": "<20자 이내 근거>"}]`;

export const buildReviewReplyJudgePrompt = (
  items: ReviewReplyJudgeItem[],
): string => {
  const lines = ['[항목]'];
  items.forEach((item, index) => {
    lines.push(
      `${index + 1}) id=${item.id}`,
      `   지적: ${item.body}`,
      `   작성자 답변: ${item.replyBody}`,
    );
  });
  return lines.join('\n');
};
