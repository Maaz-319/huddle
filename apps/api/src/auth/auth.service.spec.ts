import { FakeUserRepository } from '../../test/fakes/fake-user-repository';
import { AuthService } from './auth.service';
import { UserProfile } from './user-repository.interface';

describe('AuthService', () => {
  let users: FakeUserRepository;
  let service: AuthService;

  beforeEach(() => {
    users = new FakeUserRepository();
    service = new AuthService(users);
  });

  const profile: UserProfile = {
    githubId: 'gh-1',
    username: 'octocat',
    avatarUrl: 'https://example.com/avatar.png',
    email: 'octocat@example.com',
  };

  it('provisions a new user on first login', async () => {
    const user = await service.loginWithGithub(profile);

    expect(user.githubId).toBe(profile.githubId);
    expect(user.username).toBe(profile.username);
    expect(user.avatarUrl).toBe(profile.avatarUrl);
    expect(user.email).toBe(profile.email);
    expect(user.bio).toBeNull();
  });

  it('re-syncs the GitHub-owned fields on a later login, without duplicating', async () => {
    const first = await service.loginWithGithub(profile);

    const updatedProfile: UserProfile = {
      ...profile,
      username: 'octocat-renamed',
      avatarUrl: 'https://example.com/new-avatar.png',
      email: 'new-email@example.com',
    };

    const second = await service.loginWithGithub(updatedProfile);

    expect(second.id).toBe(first.id);
    expect(second.username).toBe('octocat-renamed');
    expect(second.avatarUrl).toBe('https://example.com/new-avatar.png');
    expect(second.email).toBe('new-email@example.com');

    const all = await users.findByGithubId(profile.githubId);
    expect(all?.id).toBe(first.id);
  });

  it('updateBio sets the bio via the repository', async () => {
    const user = await service.loginWithGithub(profile);

    const updated = await service.updateBio(user.id, 'Hello, world.');

    expect(updated.bio).toBe('Hello, world.');
  });
});
