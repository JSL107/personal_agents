import { BadRequestException } from '@nestjs/common';

export const parseDateParam = (value: string, label: string): Date => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${label} 는 YYYY-MM-DD 형식이어야 합니다.`);
  }
  // new Date('2026-02-31') 은 Invalid 가 아니라 3월 3일로 굴러간다. 되돌려 찍어 원문과
  // 다르면 달력에 없는 날짜다 — 조용히 다음 달을 긁어오는 것을 여기서 끊는다.
  if (parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(
      `${label} 에 달력에 없는 날짜가 들어왔습니다.`,
    );
  }
  return parsed;
};
