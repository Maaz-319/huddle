import {
  Channel,
  ChannelRepository,
  CreateChannelInput,
  UpdateChannelInput,
} from '../../src/administration/channel-repository.interface';
import { ConflictError, NotFoundError } from '../../src/common/errors';
import { FakeAdministrationStore } from './fake-administration-store';

/** Snowflake-shaped, i.e. too large for a JS number, so ids look real. */
const FIRST_ID = 700000000000000001n;

/**
 * In-memory `ChannelRepository`, for unit tests of the services and guards
 * that depend on the port.
 *
 * `extends ChannelRepository` rather than duck-typing it, same reasoning as
 * `FakeServerRepository`'s own doc: a method added to the port then breaks
 * compilation here.
 */
export class FakeChannelRepository extends ChannelRepository {
  private nextId = FIRST_ID;

  constructor(private readonly store: FakeAdministrationStore) {
    super();
  }

  create(input: CreateChannelInput): Promise<Channel> {
    if (this.nameTaken(input.serverId, input.name)) {
      return Promise.reject(this.duplicateName(input.serverId, input.name));
    }

    const channel: Channel = {
      id: this.nextId++,
      createdAt: new Date(),
      ...input,
    };
    this.store.channels.set(channel.id, channel);

    return Promise.resolve({ ...channel });
  }

  findById(id: bigint): Promise<Channel | null> {
    const channel = this.store.channels.get(id);

    return Promise.resolve(channel === undefined ? null : { ...channel });
  }

  findByServerId(serverId: bigint): Promise<Channel[]> {
    const channels = [...this.store.channels.values()]
      .filter((channel) => channel.serverId === serverId)
      .map((channel) => ({ ...channel }));

    return Promise.resolve(channels);
  }

  findByServerIds(serverIds: bigint[]): Promise<Channel[]> {
    const wanted = new Set(serverIds);
    const channels = [...this.store.channels.values()]
      .filter((channel) => wanted.has(channel.serverId))
      .map((channel) => ({ ...channel }))
      // The adapter orders by `id asc`; the fake sorts to hold the same
      // contract rather than inheriting Map insertion order.
      .sort((a, b) => (a.id === b.id ? 0 : a.id < b.id ? -1 : 1));

    return Promise.resolve(channels);
  }

  update(id: bigint, patch: UpdateChannelInput): Promise<Channel> {
    const existing = this.store.channels.get(id);

    if (existing === undefined) {
      return Promise.reject(
        new NotFoundError('Channel not found', { id: id.toString() }),
      );
    }

    const updated: Channel = { ...existing, ...patch };

    if (
      updated.name !== existing.name &&
      this.nameTaken(updated.serverId, updated.name)
    ) {
      return Promise.reject(this.duplicateName(updated.serverId, updated.name));
    }

    this.store.channels.set(id, updated);

    return Promise.resolve({ ...updated });
  }

  delete(id: bigint): Promise<void> {
    if (!this.store.channels.delete(id)) {
      return Promise.reject(
        new NotFoundError('Channel not found', { id: id.toString() }),
      );
    }

    return Promise.resolve();
  }

  /** Mirrors the real `UNIQUE (serverId, name)` — data-model.md section 4.4. */
  private nameTaken(serverId: bigint, name: string): boolean {
    return [...this.store.channels.values()].some(
      (channel) => channel.serverId === serverId && channel.name === name,
    );
  }

  private duplicateName(serverId: bigint, name: string): ConflictError {
    return new ConflictError('A channel with this name already exists', {
      serverId: serverId.toString(),
      name,
    });
  }
}
