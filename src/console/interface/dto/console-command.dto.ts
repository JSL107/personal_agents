import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// 리모컨 자연어/힌트 지시 요청. agentTypeHint 는 문자열로 받고 service 에서 AgentType 으로 취급한다
// (미지 hint 는 dispatch 의 intent classifier 가 자연스럽게 걸러냄).
export class ConsoleCommandDto {
  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsOptional()
  @IsString()
  agentTypeHint?: string;

  @IsOptional()
  @IsString()
  commandId?: string;
}
