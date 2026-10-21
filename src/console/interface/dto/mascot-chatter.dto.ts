import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';

// 오늘 [나중에]를 누른 후보. 서버가 실제 제안 후보와 교집합으로 걸러 쓴다.
export class MascotChatterDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  declinedAgentTypes?: string[];
}
