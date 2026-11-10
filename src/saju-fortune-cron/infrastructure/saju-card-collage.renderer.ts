import { Injectable } from '@nestjs/common';
import * as sharpModule from 'sharp';

import { MonthCard } from '../domain/port/saju-fortune-day.repository.port';
import { CardCellSize, cardGridLayoutOf } from '../domain/saju-card-grid';

// sharp 는 CommonJS 함수 export 라 namespace import 를 함수로 쓴다(image.downloader.ts 와 같은 방식).
const sharp = sharpModule as unknown as typeof sharpModule.default;

// 카드 그림은 2:3 세로라 썸네일도 같은 비율로 맞춘다.
export const CARD_CELL: CardCellSize = {
  cellWidth: 240,
  cellHeight: 360,
  labelHeight: 40,
  gap: 16,
};
const THUMBNAIL_QUALITY = 80;
// 카드 덱의 짙은 남색과 맞춘다.
const BACKGROUND = { r: 18, g: 24, b: 48 };
const LABEL_COLOR = '#E8D9A8';
const LABEL_FONT_SIZE = 24;

// 'YYYY-MM-DD' → 'MM/DD'. 숫자와 / 만 그려 한글 글꼴에 기대지 않는다.
const labelOf = (fortuneDate: string): string =>
  fortuneDate.slice(5).replace('-', '/');

// 카드 썸네일(하루 기록에 남김)과 월별 카드 모음 그림.
@Injectable()
export class SajuCardCollageRenderer {
  async toThumbnail(png: Buffer): Promise<Buffer> {
    const thumbnail = await sharp(png)
      .resize({
        width: CARD_CELL.cellWidth,
        height: CARD_CELL.cellHeight,
        fit: 'cover',
      })
      .jpeg({ quality: THUMBNAIL_QUALITY })
      .toBuffer();
    return thumbnail;
  }

  async renderMonth(cards: MonthCard[]): Promise<Buffer> {
    const layout = cardGridLayoutOf({ count: cards.length, ...CARD_CELL });
    const labels = cards.map(({ fortuneDate }, index) => {
      const { left, top } = layout.cells[index];
      const x = left + CARD_CELL.cellWidth / 2;
      const y = top + CARD_CELL.cellHeight + CARD_CELL.labelHeight * 0.75;
      const label = `<text x="${x}" y="${y}" text-anchor="middle">${labelOf(fortuneDate)}</text>`;
      return label;
    });
    const labelSvg = [
      `<svg width="${layout.width}" height="${layout.height}" xmlns="http://www.w3.org/2000/svg">`,
      `<g font-family="sans-serif" font-size="${LABEL_FONT_SIZE}" fill="${LABEL_COLOR}">`,
      ...labels,
      '</g></svg>',
    ].join('');
    const thumbnails = cards.map(({ thumbnail }, index) => ({
      input: thumbnail,
      ...layout.cells[index],
    }));
    const collage = await sharp({
      create: {
        width: layout.width,
        height: layout.height,
        channels: 3,
        background: BACKGROUND,
      },
    })
      .composite([
        ...thumbnails,
        { input: Buffer.from(labelSvg), left: 0, top: 0 },
      ])
      .png()
      .toBuffer();
    return collage;
  }
}
