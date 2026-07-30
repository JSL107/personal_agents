import { IsString } from 'class-validator';

// 세션 주입 요청. 빈/공백 판정은 SessionInjectService 가 소유(단일 소스)하므로 여기선 타입만 강제.
export class SessionInjectDto {
  @IsString()
  text!: string;
}
