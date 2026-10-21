import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

import { ReplyPersona } from '../../../router/domain/conversation-context.type';

export class MascotSuggestionAcceptDto {
  @IsString()
  @IsNotEmpty()
  agentType!: string;

  @IsOptional()
  @IsString()
  commandId?: string;

  @IsOptional()
  @IsIn(['USAGI'])
  persona?: ReplyPersona;
}
