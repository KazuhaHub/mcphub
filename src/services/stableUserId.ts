import { randomUUID } from 'node:crypto';
import { getUserDao } from '../dao/index.js';

/**
 * The identifier of a MCPHub account that never changes and is never given to another account:
 * the claim `mcphub_uid` in tokens for external resources (ADR 0014).
 *
 * `sub` is the username, which an administrator can free by deleting a user and a new person can
 * then take. A resource server that keys its data by `sub` alone would hand the new person the old
 * person's data; keyed by this id it cannot.
 *
 * - Database mode: the user's primary key (`users.id`, a UUID generated once by the database, not
 *   updatable through any API, and never reused: a new account gets a new UUID).
 * - File mode: `stableId`, a random UUID written at creation and, for accounts that predate it, on
 *   first use. It is write-once in the user DAO. A deleted account takes its id with it.
 *
 * Returns undefined when no such account exists, so a token is never issued for a user that is gone.
 */
export const resolveStableUserId = async (username: string): Promise<string | undefined> => {
  const dao = getUserDao();
  const user = await dao.findByUsername(username);
  if (!user) return undefined;
  if (user.id) return user.id;
  if (user.stableId) return user.stableId;
  // Backfill for an account created before the id existed. The DAO keeps the first id written, so
  // re-read: if another writer got there first, theirs is authoritative.
  const updated = await dao.update(username, { stableId: randomUUID() });
  if (!updated) return undefined;
  return (await dao.findByUsername(username))?.stableId ?? updated.stableId;
};
