import { Prisma } from '@prisma/client';

import { TransitionInput } from '../domain/schedule.repository.type';

export interface TransitionInTransactionInput {
  client: Prisma.TransactionClient;
  input: TransitionInput;
}
