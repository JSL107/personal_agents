import { BeSchemaException } from '../domain/be-schema.exception';
import { GenerateSchemaProposalUsecase } from './generate-schema-proposal.usecase';

describe('GenerateSchemaProposalUsecase', () => {
  it('request 가 비어 있으면 BeSchemaException 발생', async () => {
    const usecase = new GenerateSchemaProposalUsecase(
      null as never,
      null as never,
      null as never,
    );
    await expect(
      usecase.execute({ request: '   ', slackUserId: 'U1' }),
    ).rejects.toThrow(BeSchemaException);
  });

  it('schemaFileReader 실패 시 예외 전파', async () => {
    const reader = {
      readSchema: jest.fn().mockRejectedValue(new Error('schema not found')),
    };
    const usecase = new GenerateSchemaProposalUsecase(
      null as never,
      null as never,
      reader as never,
    );
    await expect(
      usecase.execute({ request: 'add orders table', slackUserId: 'U1' }),
    ).rejects.toThrow('schema not found');
  });
});
