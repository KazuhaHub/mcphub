const mockRepository = {
  findBy: jest.fn(),
  findOneBy: jest.fn(),
  upsert: jest.fn(),
  delete: jest.fn(),
  update: jest.fn(),
};

jest.mock('../../src/db/connection.js', () => ({
  getAppDataSource: () => ({
    getRepository: () => mockRepository,
  }),
}));

import { UserServerSelectionDaoDbImpl } from '../../src/dao/UserServerSelectionDaoDbImpl.js';
import { UserServerSelectionRecord } from '../../src/db/entities/UserServerSelectionRecord.js';
import entities from '../../src/db/entities/index.js';
import { getMetadataArgsStorage } from 'typeorm';

const selection = {
  username: 'alice',
  serverName: 'fetch',
  selected: true,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('UserServerSelectionDaoDbImpl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepository.findOneBy.mockResolvedValue(null);
  });

  it('is registered as a database entity, indexed by username', () => {
    expect(entities).toContain(UserServerSelectionRecord);
    expect(
      getMetadataArgsStorage().indices.some(
        (index) =>
          index.target === UserServerSelectionRecord &&
          [index.columns].flat().includes('username' as never),
      ),
    ).toBe(true);
  });

  it('lists a user’s selections', async () => {
    mockRepository.findBy.mockResolvedValue([selection]);

    await expect(new UserServerSelectionDaoDbImpl().listByUsername('alice')).resolves.toEqual([
      selection,
    ]);
    expect(mockRepository.findBy).toHaveBeenCalledWith({ username: 'alice' });
  });

  it('upserts on the (server, user) key', async () => {
    await new UserServerSelectionDaoDbImpl().save(selection);

    expect(mockRepository.upsert).toHaveBeenCalledWith(selection, ['serverName', 'username']);
  });

  describe('added flag', () => {
    it('declares a nullable column, so rows from before the list existed need no backfill', () => {
      const column = getMetadataArgsStorage().columns.find(
        (candidate) =>
          candidate.target === UserServerSelectionRecord && candidate.propertyName === 'added',
      );
      expect(column?.options.nullable).toBe(true);
    });

    it('reads null as absent and a stored value as is', async () => {
      mockRepository.findBy.mockResolvedValue([
        { ...selection, added: null },
        { ...selection, serverName: 'git', added: false },
      ]);
      const rows = await new UserServerSelectionDaoDbImpl().listByUsername('alice');
      expect(rows[0]).not.toHaveProperty('added');
      expect(rows[1]).toHaveProperty('added', false);
    });

    it('gives a stored row without the flag the value it meant when it is saved again', async () => {
      mockRepository.findOneBy.mockResolvedValue({ ...selection, added: null, selected: true });
      await new UserServerSelectionDaoDbImpl().save({
        username: 'alice',
        serverName: 'fetch',
        selected: false,
        updatedAt: 'x',
      });
      expect(mockRepository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ selected: false, added: true }),
        ['serverName', 'username'],
      );
    });
  });

  it('deletes by the given filter', async () => {
    mockRepository.delete.mockResolvedValue({ affected: 2 });
    const dao = new UserServerSelectionDaoDbImpl();

    await expect(dao.delete({ serverName: 'fetch' })).resolves.toBe(true);
    expect(mockRepository.delete).toHaveBeenCalledWith({ serverName: 'fetch' });

    mockRepository.delete.mockResolvedValue({ affected: 0 });
    await expect(dao.delete({ serverName: 'fetch' })).resolves.toBe(false);
  });

  it('ignores a delete without a filter instead of clearing the table', async () => {
    await new UserServerSelectionDaoDbImpl().delete({});

    expect(mockRepository.delete).not.toHaveBeenCalled();
  });

  it('renames a server after clearing rows already under the new name', async () => {
    mockRepository.delete.mockResolvedValue({ affected: 0 });
    mockRepository.update.mockResolvedValue({ affected: 1 });

    await expect(new UserServerSelectionDaoDbImpl().renameServer('old', 'new')).resolves.toBe(true);

    expect(mockRepository.delete).toHaveBeenCalledWith({ serverName: 'new' });
    expect(mockRepository.update).toHaveBeenCalledWith(
      { serverName: 'old' },
      { serverName: 'new' },
    );
  });

  describe('risk ceiling', () => {
    it('declares a nullable column on the entity', () => {
      const column = getMetadataArgsStorage().columns.find(
        (candidate) =>
          candidate.target === UserServerSelectionRecord &&
          candidate.propertyName === 'riskCeiling',
      );
      expect(column?.options.nullable).toBe(true);
    });

    it('reads a missing ceiling back as absent and a stored one as is', async () => {
      mockRepository.findBy.mockResolvedValue([
        { ...selection, riskCeiling: null },
        { ...selection, serverName: 'git', riskCeiling: 'write' },
      ]);

      const rows = await new UserServerSelectionDaoDbImpl().listByUsername('alice');

      expect(rows[0]).toEqual(selection);
      expect(rows[0]).not.toHaveProperty('riskCeiling');
      expect(rows[1]).toEqual({ ...selection, serverName: 'git', riskCeiling: 'write' });
    });

    it('does not touch the ceiling column when a selection is saved without one', async () => {
      await new UserServerSelectionDaoDbImpl().save(selection);

      const [row] = mockRepository.upsert.mock.calls[0];
      expect(row.riskCeiling).toBeUndefined();
    });

    it('upserts the ceiling alone, leaving `selected` out so it keeps its value', async () => {
      await new UserServerSelectionDaoDbImpl().saveRiskCeiling(
        'alice',
        'fetch',
        'external',
        '2026-01-02T00:00:00.000Z',
      );

      expect(mockRepository.upsert).toHaveBeenCalledWith(
        {
          username: 'alice',
          serverName: 'fetch',
          riskCeiling: 'external',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
        ['serverName', 'username'],
      );
      expect(mockRepository.upsert.mock.calls[0][0]).not.toHaveProperty('selected');
    });
  });
});
