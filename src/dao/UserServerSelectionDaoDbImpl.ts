import { getAppDataSource } from '../db/connection.js';
import { UserServerSelectionRecord } from '../db/entities/UserServerSelectionRecord.js';
import type { ToolRiskLevel, UserServerSelection } from '../types/index.js';
import type { SelectionChange, UserServerSelectionDao } from './UserServerSelectionDao.js';

export class UserServerSelectionDaoDbImpl implements UserServerSelectionDao {
  private get repository() {
    return getAppDataSource().getRepository(UserServerSelectionRecord);
  }

  async listByUsername(username: string): Promise<UserServerSelection[]> {
    // Unset columns read back as null.
    return (await this.repository.findBy({ username })).map(
      ({ riskCeiling, added, ...row }): UserServerSelection => ({
        ...row,
        ...(typeof added === 'boolean' ? { added } : {}),
        ...(riskCeiling ? { riskCeiling } : {}),
      }),
    );
  }

  async save(selection: SelectionChange): Promise<void> {
    const { username, serverName } = selection;
    const existing = await this.repository.findOneBy({ username, serverName });
    // An undefined column is not part of the upsert, so a stored ceiling and a stored
    // `selected` survive. A row from before the list existed (null `added`) is given what it
    // meant, so changing `selected` does not change whether it is added.
    const added =
      selection.added ??
      (existing && typeof existing.added !== 'boolean' ? existing.selected : undefined);
    await this.repository.upsert({ ...selection, ...(added === undefined ? {} : { added }) }, [
      'serverName',
      'username',
    ]);
  }

  async saveRiskCeiling(
    username: string,
    serverName: string,
    riskCeiling: ToolRiskLevel,
    updatedAt: string,
  ): Promise<void> {
    // `selected` is left out: a new row takes its default (not selected), an existing one keeps it.
    await this.repository.upsert({ username, serverName, riskCeiling, updatedAt }, [
      'serverName',
      'username',
    ]);
  }

  async delete(filter: { serverName?: string; username?: string }): Promise<boolean> {
    if (filter.serverName === undefined && filter.username === undefined) return false;
    const result = await this.repository.delete(filter);
    return (result.affected ?? 0) > 0;
  }

  async renameServer(oldName: string, newName: string): Promise<boolean> {
    const removed = await this.repository.delete({ serverName: newName });
    const moved = await this.repository.update({ serverName: oldName }, { serverName: newName });
    return (removed.affected ?? 0) > 0 || (moved.affected ?? 0) > 0;
  }
}
