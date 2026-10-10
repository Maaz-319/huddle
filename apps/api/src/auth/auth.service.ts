import { Injectable } from '@nestjs/common';
import {
  ProfileSync,
  User,
  UserProfile,
  UserRepository,
} from './user-repository.interface';

/**
 * Login/provisioning logic, depending only on the `UserRepository` port
 * (AGENTS.md section 2) — no Passport or Express types belong in this file.
 */
@Injectable()
export class AuthService {
  constructor(private readonly users: UserRepository) {}

  /**
   * Resolves a GitHub profile to a `User`, provisioning one on first login and
   * re-syncing the GitHub-owned fields on every subsequent login. `bio` is
   * never touched here — it is not part of `ProfileSync`.
   */
  async loginWithGithub(profile: UserProfile): Promise<User> {
    const existing = await this.users.findByGithubId(profile.githubId);

    if (existing === null) {
      return this.users.create(profile);
    }

    const profileSync: ProfileSync = {
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      email: profile.email,
    };

    return this.users.updateProfile(existing.id, profileSync);
  }

  /** Sets the caller's own bio. Thin passthrough — see the port's own doc. */
  updateBio(id: bigint, bio: string | null): Promise<User> {
    return this.users.updateBio(id, bio);
  }

  /** Soft-deletes the caller's account. Thin passthrough — see the port's own doc. */
  markDeleted(id: bigint): Promise<void> {
    return this.users.markDeleted(id);
  }

  /** Multiple users by their ids. Thin passthrough — see the port's own doc. */
  findByIds(ids: bigint[]): Promise<User[]> {
    return this.users.findByIds(ids);
  }
}
