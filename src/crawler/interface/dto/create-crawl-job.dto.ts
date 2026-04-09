import { IsString, IsUrl } from 'class-validator';

export class CreateCrawlJobDto {
  @IsUrl()
  @IsString()
  url!: string;
}
