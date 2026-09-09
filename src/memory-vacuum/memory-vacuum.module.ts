import { Module } from '@nestjs/common';

import { MemoryVacuumService } from './application/memory-vacuum.service';
import { MEMORY_STORE_PORT } from './domain/port/memory-store.port';
import { MEMORY_VACUUM_PORT } from './domain/port/memory-vacuum.port';
import { MemoryStoreFsAdapter } from './infrastructure/memory-store.fs.adapter';

@Module({
  providers: [
    { provide: MEMORY_STORE_PORT, useClass: MemoryStoreFsAdapter },
    { provide: MEMORY_VACUUM_PORT, useClass: MemoryVacuumService },
  ],
  exports: [MEMORY_VACUUM_PORT],
})
export class MemoryVacuumModule {}
