import { ConflictError, NotFoundError } from '../../src/common/errors';
import {
  ProfileSync,
  User,
  UserProfile,
  UserRepository,
} from '../../src/auth/user-repository.interface';

/** Snowflake-shaped, i.e. too large for a JS number, so ids look real. */
const FIRST_ID = 300000000000000001n;

/**
 * In-memory `UserRepository`, for unit tests of the services that will depend
 * on the port (Phase 3 onward).
 *
 * `extends UserRepository` rather than duck-typing it: adding a method to the
 * port then breaks compilation here, which is the only thing keeping a fake
 * honest as the port grows.
 *
 * Ids come from a counter rather than `SnowflakeService`, keeping the fake
 * dependency-free and its output deterministic.
 */
export class FakeUserRepository extends UserRepository {
  private readonly users = new Map<bigint, User>();
  private nextId = FIRST_ID;

  findById(id: bigint): Promise<User | null> {
    return Promise.resolve(this.copyOf(this.users.get(id)));
  }

  findByGithubId(githubId: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.githubId === githubId) {
        return Promise.resolve({ ...user });
      }
    }

    return Promise.resolve(null);
  }

  create(profile: UserProfile): Promise<User> {
    for (const user of this.users.values()) {
      if (user.githubId === profile.githubId) {
        return Promise.reject(
          new ConflictError('That GitHub account already has a user', {
            githubId: profile.githubId,
          }),
        );
      }
    }

    const user: User = {
      id: this.nextId++,
      bio: null,
      deletedAt: null,
      ...profile,
    };
    this.users.set(user.id, user);

    return Promise.resolve({ ...user });
  }

  updateProfile(id: bigint, profile: ProfileSync): Promise<User> {
    const existing = this.users.get(id);

    if (existing === undefined) {
      return Promise.reject(
        new NotFoundError('User not found', { id: id.toString() }),
      );
    }

    const updated: User = { ...existing, ...profile };
    this.users.set(id, updated);

    return Promise.resolve({ ...updated });
  }

  updateBio(id: bigint, bio: string | null): Promise<User> {
    const existing = this.users.get(id);

    if (existing === undefined) {
      return Promise.reject(
        new NotFoundError('User not found', { id: id.toString() }),
      );
    }

    const updated: User = { ...existing, bio };
    this.users.set(id, updated);

    return Promise.resolve({ ...updated });
  }

  markDeleted(id: bigint): Promise<void> {
    const existing = this.users.get(id);

    if (existing === undefined) {
      return Promise.reject(
        new NotFoundError('User not found', { id: id.toString() }),
      );
    }

    this.users.set(id, { ...existing, deletedAt: new Date() });

    return Promise.resolve();
  }

  findByIds(ids: bigint[]): Promise<User[]> {
    return Promise.resolve(
      ids
        .map((id) => this.users.get(id))
        .filter((user): user is User => user !== undefined)
        .map((user) => ({ ...user })),
    );
  }

  /**
   * Puts a user in the store at a caller-chosen id. `create` mints ids from a
   * counter, but a spec's fixtures need one stable id to reference across
   * every test in the file — same reasoning as
   * `FakeServerRepository.createWithOwner` living beside the port's methods.
   */
  seed(user: User): void {
    this.users.set(user.id, { ...user });
  }

  /**
   * Hands out a copy, never the stored object. Without this a caller mutating
   * what it got back would silently rewrite the store — a difference from the
   * real adapter, which is exactly what a fake must not have.
   */
  private copyOf(user: User | undefined): User | null {
    return user === undefined ? null : { ...user };
  }
}
