import { generateInviteCode } from '../../src/administration/invite-code';
import { Invite } from '../../src/administration/invite-repository.interface';
import {
  CreateServerInput,
  OwnerMembership,
  Server,
  ServerRepository,
  UpdateServerInput,
} from '../../src/administration/server-repository.interface';
import { NotFoundError } from '../../src/common/errors';
import {
  FakeAdministrationStore,
  membershipKey,
} from './fake-administration-store';

/** Snowflake-shaped, i.e. too large for a JS number, so ids look real. */
const FIRST_ID = 400000000000000001n;

/**
 * In-memory `ServerRepository`, for unit tests of the services that will
 * depend on the port.
 *
 * `extends ServerRepository` rather than duck-typing it, same reasoning as
 * `FakeUserRepository`'s own doc: a method added to the port then breaks
 * compilation here.
 */
export class FakeServerRepository extends ServerRepository {
  private nextId = FIRST_ID;

  constructor(private readonly store: FakeAdministrationStore) {
    super();
  }

  create(input: CreateServerInput): Promise<Server> {
    const server: Server = {
      id: this.nextId++,
      createdAt: new Date(),
      ...input,
    };
    this.store.servers.set(server.id, server);

    return Promise.resolve({ ...server });
  }

  createWithOwner(
    input: CreateServerInput,
    ownerId: bigint,
  ): Promise<{ server: Server; membership: OwnerMembership; invite: Invite }> {
    const server: Server = {
      id: this.nextId++,
      createdAt: new Date(),
      ...input,
    };
    this.store.servers.set(server.id, server);

    const membership: OwnerMembership = {
      serverId: server.id,
      userId: ownerId,
      role: 'owner',
      joinedAt: new Date(),
    };
    this.store.memberships.set(membershipKey(server.id, ownerId), membership);

    const invite: Invite = {
      id: this.nextId++,
      serverId: server.id,
      code: generateInviteCode(),
      revokedAt: null,
      createdAt: new Date(),
    };
    this.store.invites.set(server.id, invite);

    return Promise.resolve({
      server: { ...server },
      membership: { ...membership },
      invite: { ...invite },
    });
  }

  findById(id: bigint): Promise<Server | null> {
    const server = this.store.servers.get(id);

    return Promise.resolve(server === undefined ? null : { ...server });
  }

  update(id: bigint, patch: UpdateServerInput): Promise<Server> {
    const existing = this.store.servers.get(id);

    if (existing === undefined) {
      return Promise.reject(
        new NotFoundError('Server not found', { id: id.toString() }),
      );
    }

    const updated: Server = { ...existing, ...patch };
    this.store.servers.set(id, updated);

    return Promise.resolve({ ...updated });
  }

  delete(id: bigint): Promise<void> {
    // Invite and Channel both cascade off Server at the schema level
    // (data-model.md section 7), so the fake drops them here too -- otherwise
    // a deleted server's code would still resolve through findByCode, and its
    // channels would still be listed.
    this.store.invites.delete(id);

    for (const [channelId, channel] of this.store.channels) {
      if (channel.serverId === id) this.store.channels.delete(channelId);
    }

    if (!this.store.servers.delete(id)) {
      return Promise.reject(
        new NotFoundError('Server not found', { id: id.toString() }),
      );
    }

    return Promise.resolve();
  }
}
