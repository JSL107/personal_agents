import { CollectedCard } from './saju-fortune-day.repository.port';

export const CARD_COLLAGE_PORT = Symbol('CARD_COLLAGE_PORT');

// 카드 그림 줄이기·모으기. 그림 처리 라이브러리(sharp)는 infrastructure 어댑터에만 둔다.
export interface CardCollagePort {
  // 하루 기록에 남길 썸네일.
  toThumbnail(png: Buffer): Promise<Buffer>;
  // 카드들을 격자 한 장(PNG)으로.
  renderCards(cards: CollectedCard[]): Promise<Buffer>;
}
