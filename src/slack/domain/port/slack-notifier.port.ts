import { PreviewCardMessage } from '../../../preview-gate/domain/preview-action.type';

export const SLACK_NOTIFIER_PORT = Symbol('SLACK_NOTIFIER_PORT');

// 슬랙 발송 책임만 추상화한 port. 크론 소비자(autopilot·resume-calibration·job-application-nudge·
// study-brief)가 SlackService 를 직접 의존하지 않게 하고, 향후 다른 알림 어댑터(Telegram 등)를
// 붙일 때 소비자 변경 없이 모듈 wiring 만 바꾸게 하는 것이 목적이다.
//
// 이 파일은 원래 `morning-briefing/domain/port/` 에 있었다. 그 자리는 처음 이 포트를 뽑아낸
// 소비자(MorningBriefingConsumer)를 따라간 것인데, 그 소비자는 이후 사라졌고 정작
// morning-briefing 은 이 포트를 쓰지 않게 됐다. 소유자가 아닌 모듈이 계약을 들고 있으면
// 계약이 넓어질 때마다(카드 렌더 입력이 붙는 식) 그 모듈이 남의 개념을 import 하게 된다.
// 발송 계약이므로 발송 어댑터가 사는 곳(SlackService 와 같은 경계)이 소유한다.
export interface SlackNotifierPort {
  // target: 슬랙 user ID(`U...`) / 채널 ID(`C.../G...`) — chat.postMessage 의 channel 파라미터.
  // threadTs 지정 시 해당 메시지의 스레드 댓글로 발송. 반환 ts 는 후속 스레드 발송용.
  // unfurlLinks=false 면 링크 미리보기(카드·썸네일)를 끈다. 링크가 여러 개인 요약
  // 메시지는 미리보기가 붙는 순간 본문보다 길어져 요약 구실을 못 한다. 기본은 종전대로 켜짐.
  postMessage(input: {
    target: string;
    text: string;
    threadTs?: string;
    unfurlLinks?: boolean;
  }): Promise<{ ts: string | undefined }>;
  // T1_PREVIEW 승인 카드. 반환된 좌표(channelId/messageTs)로 이후 chat.update(카드 갱신)가 가능.
  //
  // 카드를 무엇으로 그릴지는 preview-gate 의 개념이라 그쪽이 소유하는 PreviewCardMessage 를 받는다.
  // 여기서 previewId·kind·payload 를 낱개로 늘어놓으면 카드 종류가 늘 때마다 이 계약이 따라
  // 넓어지고, 발송 포트가 승인 카드의 내부 사정을 알게 된다.
  postPreviewMessage(input: {
    target: string;
    preview: PreviewCardMessage;
  }): Promise<{ channelId: string; messageTs: string }>;
  // 이미지를 채널(또는 스레드)에 올린다. 텍스트로는 못 보여주는 것 — 시간축 위의 곡선,
  // 분포 — 을 카드에 그림으로 싣기 위한 경로다.
  //
  // `files:write` 스코프가 필요하다. 없으면 슬랙이 `missing_scope` 로 끊는데, 그것은
  // 발송 실패이지 이미지 문제가 아니므로 호출부가 텍스트만이라도 살릴 수 있게 예외로 던진다.
  //
  // ⚠️ 업로드 응답은 즉시 오지만 슬랙이 그 파일을 **이미지로 처리하는 것은 비동기**다.
  // 2026-09-22 실측: 업로드 직후 `files.info` 는 `mimetype: ''` · 썸네일 없음으로 오고,
  // 3초 뒤에야 `image/png` 와 `thumb_360` 이 채워졌다. 응답의 그 필드로 성공을 판정하면
  // 정상 업로드를 실패로 읽는다 — 판정은 API 오류 유무로만 한다.
  uploadImage(input: {
    target: string;
    threadTs?: string;
    png: Buffer;
    filename: string;
    title: string;
  }): Promise<{ fileId: string | undefined }>;
}
