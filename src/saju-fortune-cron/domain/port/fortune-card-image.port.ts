export const FORTUNE_CARD_IMAGE_PORT = Symbol('FORTUNE_CARD_IMAGE_PORT');

export interface FortuneCardImagePort {
  // 그림 생성 지시를 받아 PNG 를 돌려준다. 실패하면 예외 — 호출부가 글만이라도 보낸다.
  generate(prompt: string): Promise<Buffer>;
}
