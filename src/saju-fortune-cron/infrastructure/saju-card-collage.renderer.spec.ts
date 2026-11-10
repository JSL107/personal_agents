import * as sharpModule from 'sharp';

import { cardGridLayoutOf } from '../domain/saju-card-grid';
import {
  CARD_CELL,
  SajuCardCollageRenderer,
} from './saju-card-collage.renderer';

const sharp = sharpModule as unknown as typeof sharpModule.default;

const solidPng = (): Promise<Buffer> =>
  sharp({
    create: {
      width: 300,
      height: 450,
      channels: 3,
      background: { r: 20, g: 40, b: 90 },
    },
  })
    .png()
    .toBuffer();

describe('SajuCardCollageRenderer', () => {
  const renderer = new SajuCardCollageRenderer();

  it('toThumbnail 은 가로 240 JPEG 를 만든다', async () => {
    const thumbnail = await renderer.toThumbnail(await solidPng());

    const metadata = await sharp(thumbnail).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(240);
  });

  it('renderMonth 는 5장이면 4열 2행 크기의 PNG', async () => {
    const thumbnail = await renderer.toThumbnail(await solidPng());
    const cards = ['01', '02', '03', '04', '05'].map((day) => ({
      fortuneDate: `2026-11-${day}`,
      thumbnail,
    }));

    const collage = await renderer.renderMonth(cards);

    const metadata = await sharp(collage).metadata();
    const layout = cardGridLayoutOf({ count: 5, ...CARD_CELL });
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(layout.width);
    expect(metadata.height).toBe(layout.height);
  });
});
