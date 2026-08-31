import {
  Capability,
  ChannelOverride,
  ChannelOverrideRepository,
  OverrideRole,
} from '../../src/administration/channel-override-repository.interface';
import {
  channelOverrideKey,
  FakeAdministrationStore,
} from './fake-administration-store';

/**
 * In-memory `ChannelOverrideRepository`.
 *
 * `extends ChannelOverrideRepository` rather than duck-typing it, same
 * reasoning as `FakeServerRepository`'s own doc: a method added to the port
 * then breaks compilation here.
 */
export class FakeChannelOverrideRepository extends ChannelOverrideRepository {
  constructor(private readonly store: FakeAdministrationStore) {
    super();
  }

  findByChannelId(channelId: bigint): Promise<ChannelOverride[]> {
    const overrides = [...this.store.channelOverrides.values()]
      .filter((override) => override.channelId === channelId)
      .map((override) => ({ ...override }));

    return Promise.resolve(overrides);
  }

  findByChannelIds(channelIds: bigint[]): Promise<ChannelOverride[]> {
    const wanted = new Set(channelIds);
    const overrides = [...this.store.channelOverrides.values()]
      .filter((override) => wanted.has(override.channelId))
      .map((override) => ({ ...override }));

    return Promise.resolve(overrides);
  }

  revoke(
    channelId: bigint,
    role: OverrideRole,
    capability: Capability,
  ): Promise<void> {
    // Keyed on the whole primary key, so revoking twice is one row -- the
    // Map is doing what the real @@id does.
    this.store.channelOverrides.set(
      channelOverrideKey(channelId, role, capability),
      { channelId, role, capability },
    );

    return Promise.resolve();
  }

  restore(
    channelId: bigint,
    role: OverrideRole,
    capability: Capability,
  ): Promise<void> {
    this.store.channelOverrides.delete(
      channelOverrideKey(channelId, role, capability),
    );

    return Promise.resolve();
  }
}
