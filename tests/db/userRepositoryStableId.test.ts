const repo = {
  exists: jest.fn(),
  create: jest.fn((value: Record<string, unknown>) => ({ ...value })),
  save: jest.fn(async (value: Record<string, unknown>) => ({ id: 'generated-id', ...value })),
};
jest.mock('../../src/db/connection.js', () => ({
  getAppDataSource: () => ({ getRepository: () => repo }),
}));
jest.mock('../../src/utils/logger.js', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), log: jest.fn(), debug: jest.fn() },
}));

import { UserRepository } from '../../src/db/repositories/UserRepository.js';
import { logger } from '../../src/utils/logger.js';

const base = { username: 'alice', password: 'x', isAdmin: false, email: null, ssoUserId: null };

beforeEach(() => jest.clearAllMocks());

it('uses a carried-over stable id for a new row', async () => {
  repo.exists.mockResolvedValue(false);
  await new UserRepository().create({ ...base, id: 'carried-id' });
  expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ id: 'carried-id' }));
  expect(logger.warn).not.toHaveBeenCalled();
});

it('drops an id that another account already has and warns with the user and both ids', async () => {
  repo.exists.mockResolvedValue(true);
  await new UserRepository().create({ ...base, id: 'taken-id' });
  expect(repo.create).toHaveBeenCalledWith(expect.not.objectContaining({ id: expect.anything() }));
  const message = String((logger.warn as jest.Mock).mock.calls[0][0]);
  expect(message).toContain("'alice'");
  expect(message).toContain('taken-id');
  expect(message).toContain('generated-id');
});
