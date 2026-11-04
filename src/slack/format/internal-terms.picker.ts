import { AutopilotTaskResult } from '../../autopilot/domain/autopilot-task.port';

// task 결과에서는 Slack 에 실리는 문구만 본다. 카드 payload·판정 facet 에는 enum 값이 정상으로 들어 있다.
export const pickTaskText = (value: unknown): unknown[] => {
  const result = (value ?? {}) as Partial<AutopilotTaskResult>;
  return [
    result.summaryText,
    result.detailText,
    result.headlineText,
    // 이미지·파일 제목도 Slack 에 그대로 보인다(orchestrator 가 제목·대체 텍스트로 싣는다).
    result.detailImage?.title,
    result.detailFile?.title,
    result.detailFile?.content,
    // 카드는 slackText 가 있으면 그것을 그린다(buildPreviewBlocks). 둘 다 본다 — previewText 는 콘솔 승인 상세에 보인다.
    result.preview?.previewText,
    result.preview?.slackText,
    ...(result.previews ?? []).flatMap((preview) => [
      preview.previewText,
      preview.slackText,
    ]),
    ...(result.runVerdicts ?? []).map((verdict) => verdict.quote),
  ];
};
