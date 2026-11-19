import { Repository } from 'typeorm';
import { User } from '../entities/User.js';
import { getAppDataSource } from '../connection.js';
import { withDbRetry, RetryOptions } from '../../utils/dbRetry.js';
import { logger } from '../../utils/logger.js';

// Default retry options
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Repository for User entity with automatic retry logic
 */
export class UserRepository {
  private get repository(): Repository<User> {
    return getAppDataSource().getRepository(User);
  }
  private retryOptions: RetryOptions;

  constructor(retryOptions?: RetryOptions) {
    this.retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions };
  }

  /**
   * Execute an operation with retry logic
   */
  private async withRetry<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    return withDbRetry(operation, {
      ...this.retryOptions,
      operationName: `UserRepository.${operationName}`,
    });
  }

  /**
   * Find all users
   */
  async findAll(): Promise<User[]> {
    return this.withRetry(() => this.repository.find({ order: { createdAt: 'ASC' } }), 'findAll');
  }

  /**
   * Find user by username
   */
  async findByUsername(username: string): Promise<User | null> {
    return this.withRetry(() => this.repository.findOne({ where: { username } }), 'findByUsername');
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.withRetry(() => this.repository.findOne({ where: { email } }), 'findByEmail');
  }

  async findBySsoUserId(ssoUserId: string): Promise<User | null> {
    return this.withRetry(
      () => this.repository.findOne({ where: { ssoUserId } }),
      'findBySsoUserId',
    );
  }

  /**
   * Create a new user
   */
  async create(
    user: Omit<User, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  ): Promise<User> {
    return this.withRetry(async () => {
      // An explicit id (a stable id carried over from file mode) is used only for a new row: `save`
      // would otherwise update whichever account already has it.
      const { id, ...rest } = user;
      const taken = id ? await this.repository.exists({ where: { id } }) : false;
      const newUser = this.repository.create(id && !taken ? { ...rest, id } : rest);
      const saved = await this.repository.save(newUser);
      if (id && taken) {
        logger.warn(
          `User '${user.username}' keeps a new stable id: the id ${id} carried over from file mode is already used by another account; mcphub_uid changes from ${id} to ${saved.id}`,
        );
      }
      return saved;
    }, 'create');
  }

  /**
   * Update an existing user
   */
  async update(username: string, userData: Partial<User>): Promise<User | null> {
    return this.withRetry(async () => {
      const user = await this.repository.findOne({ where: { username } });
      if (!user) {
        return null;
      }
      const updated = this.repository.merge(user, userData);
      return await this.repository.save(updated);
    }, 'update');
  }

  /**
   * Delete a user
   */
  async delete(username: string): Promise<boolean> {
    return this.withRetry(async () => {
      const result = await this.repository.delete({ username });
      return (result.affected ?? 0) > 0;
    }, 'delete');
  }

  /**
   * Check if user exists
   */
  async exists(username: string): Promise<boolean> {
    return this.withRetry(async () => {
      const count = await this.repository.count({ where: { username } });
      return count > 0;
    }, 'exists');
  }

  /**
   * Count total users
   */
  async count(): Promise<number> {
    return this.withRetry(() => this.repository.count(), 'count');
  }

  /**
   * Find all admin users
   */
  async findAdmins(): Promise<User[]> {
    return this.withRetry(
      () => this.repository.find({ where: { isAdmin: true }, order: { createdAt: 'ASC' } }),
      'findAdmins',
    );
  }
}

export default UserRepository;
