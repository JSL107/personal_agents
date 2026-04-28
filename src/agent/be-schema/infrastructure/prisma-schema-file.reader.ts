import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { BeSchemaException } from '../domain/be-schema.exception';
import { BeSchemaErrorCode } from '../domain/be-schema-error-code.enum';
import { SchemaFileReaderPort } from '../domain/port/schema-file.reader.port';

const SCHEMA_RELATIVE_PATH = path.join('prisma', 'schema.prisma');

@Injectable()
export class PrismaSchemaFileReader implements SchemaFileReaderPort {
  private readonly logger = new Logger(PrismaSchemaFileReader.name);

  async readSchema(): Promise<string> {
    const absPath = path.resolve(process.cwd(), SCHEMA_RELATIVE_PATH);
    try {
      return await fs.readFile(absPath, 'utf-8');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `prisma/schema.prisma 읽기 실패 — path=${absPath}: ${message}`,
      );
      throw new BeSchemaException({
        code: BeSchemaErrorCode.SCHEMA_FILE_NOT_FOUND,
        message: `prisma/schema.prisma 를 읽지 못했습니다 (cwd=${process.cwd()}). 프로젝트 루트에서 앱을 기동했는지 확인해주세요.`,
        status: DomainStatus.PRECONDITION_FAILED,
        cause: error,
      });
    }
  }
}
