/**
 * A Huddle user, as the rest of the application sees one.
 *
 * Declared here rather than re-exported from the generated Prisma client on
 * purpose: the port is the line the vendor stops at (AGENTS.md section 2). If
 * this were `Prisma.UserModel`, every consumer of the port would import a
 * Prisma type, and swapping the adapter would ripple through all of them.
 * The adapter maps its row onto this shape.
 *
 * There is no `createdAt`: it is decoded from the Snowflake `id`
 * (docs/architecture/data-model.md section 3).
 */
export interface User {
  id: bigint;
  githubId: string;
  username: string;
  avatarUrl: string;
  email: string;
  bio: string | null;
}

/**
 * What GitHub tells us about a person on first login. `githubId` is GitHub's
 * numeric id as a string — the immutable, durable key
 * (docs/architecture/auth-service.md section 2).
 */
export interface UserProfile {
  githubId: string;
  username: string;
  avatarUrl: string;
  email: string;
}

/**
 * The fields re-fetched from GitHub and overwritten on *every* login. Huddle
 * never lets a user set a different handle locally, so these are not
 * user-editable. `bio` is, which is why it is absent here.
 */
export type ProfileSync = Omit<UserProfile, 'githubId'>;

/**
 * Persistence for user records.
 *
 * An abstract class, never a TypeScript `interface`: Nest binds DI against a
 * runtime token, and an interface is erased at compile time, so
 * `{ provide: UserRepository, ... }` would be `provide: undefined`. That fails
 * at boot, not at compile time. See docs/architecture/repo-structure.md
 * section 3.
 *
 * There is deliberately no `delete`. Every foreign key pointing at `User` is
 * `Restrict` (docs/architecture/data-model.md section 7), and account deletion
 * revokes access while preserving message history
 * (docs/architecture/auth-service.md section 6) — it is not a row delete. What
 * revocation calls is Phase 3's decision.
 */
export abstract class UserRepository {
  /** The user with this id, or `null`. */
  abstract findById(id: bigint): Promise<User | null>;

  /** The user holding this GitHub id, or `null`. Resolves a login. */
  abstract findByGithubId(githubId: string): Promise<User | null>;

  /**
   * Provisions a user on first login, minting the Snowflake id.
   *
   * Throws `ConflictError` if `githubId` is already taken — that is a caller
   * bug, since login looks the user up first.
   */
  abstract create(profile: UserProfile): Promise<User>;

  /**
   * Re-syncs the GitHub-owned fields on every subsequent login. Leaves `bio`
   * and `githubId` untouched.
   *
   * Throws `NotFoundError` if no such user exists.
   */
  abstract updateProfile(id: bigint, profile: ProfileSync): Promise<User>;

  /**
   * Sets the user's own bio, the one profile field GitHub does not own.
   * Deliberately separate from `updateProfile` — that method is exactly the
   * GitHub-synced fields, and `bio` is exactly not one of them.
   *
   * `null` clears it. Throws `NotFoundError` if no such user exists.
   */
  abstract updateBio(id: bigint, bio: string | null): Promise<User>;
}
