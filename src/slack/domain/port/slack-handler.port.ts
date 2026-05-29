import { App } from '@slack/bolt';

// C-4 SlackHandlerRegistry — slack.service.ts 의 31 deps 집중을 분해하기 위한 표준 port.
// 각 handler 가 SlackHandler 를 구현하고 SLACK_HANDLER_PORT multi-provider 로 자기 모듈에서
// 등록. SlackService 는 부팅 시 handlers.forEach(h => h.register(app)) 만 호출.
// (RouterModule 의 AGENT_DISPATCHER_PORT / PreviewGate 의 PREVIEW_APPLIERS 패턴과 정렬.)
export const SLACK_HANDLER_PORT = Symbol('SLACK_HANDLER_PORT');

export interface SlackHandler {
  // Bolt App 에 본 handler 의 명령/액션/이벤트 listener 등록.
  // 동기 — 등록 자체는 Bolt 가 즉시 처리. 실제 handler 콜백 안 작업은 async OK.
  register(app: App): void;
}
