import { IsOptional, IsString, MaxLength } from 'class-validator';

// 콘솔 캘린더의 등록 폼이 보내는 몸통.
//
// 날짜 **형식** 검사는 여기 두지 않는다 — `parsePlainDateParam` 이 `2026-02-30` 처럼 달력에
// 없는 날짜까지 걸러내므로, 정규식을 여기 또 적으면 같은 규칙이 두 벌이 되어 한쪽만 바뀐다.
// 여기서는 타입만 막는다: 숫자가 들어오면 `new Date(20260930)` 이 되어 엉뚱한 날에 저장된다.
//
// 길이 상한은 화면 입력이 열리면서 처음 필요해진 것이다. Slack 경로는 한 줄 발화라 사실상
// 짧지만, 폼은 붙여넣기로 임의 길이가 들어온다.
export class CreateScheduleDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  dueDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  memo?: string;
}
