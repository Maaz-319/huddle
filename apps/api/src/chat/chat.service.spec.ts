import { FakeAdministrationStore } from '../../test/fakes/fake-administration-store';
import { FakeChannelRepository } from '../../test/fakes/fake-channel-repository';
import { FakeMessageRepository } from '../../test/fakes/fake-message-repository';
import { FakeServerRepository } from '../../test/fakes/fake-server-repository';
import { ChatService } from './chat.service';
import { MessageRepository } from './message-repository.interface';

const OWNER_ID = 350000000000000001n;

describe('ChatService', () => {
  let service: ChatService;
  let messages: MessageRepository;
  let channelId: bigint;

  beforeEach(async () => {
    const store = new FakeAdministrationStore();
    messages = new FakeMessageRepository(store);
    const channels = new FakeChannelRepository(store);
    const servers = new FakeServerRepository(store);
    service = new ChatService(messages);

    const { server } = await servers.createWithOwner(
      {
        name: 'Huddle HQ',
        iconUrl: null,
        channelCreationPolicy: 'everyone',
        memberInviteToggle: true,
      },
      OWNER_ID,
    );
    const channel = await channels.create({
      serverId: server.id,
      name: 'general',
      isPrivate: false,
    });
    channelId = channel.id;
  });

  /** `count` messages in the channel, oldest first. */
  async function seed(count: number): Promise<bigint[]> {
    const ids: bigint[] = [];

    for (let index = 0; index < count; index += 1) {
      const message = await service.sendMessage(
        channelId,
        OWNER_ID,
        `message ${index}`,
      );
      ids.push(message.id);
    }

    return ids;
  }

  describe('sendMessage', () => {
    it('stores the content it was given', async () => {
      const message = await service.sendMessage(channelId, OWNER_ID, 'hello');

      expect(message.content).toBe('hello');
      await expect(messages.findById(message.id)).resolves.toEqual(message);
    });
  });

  describe('getHistory', () => {
    it('returns the newest page when neither cursor is given', async () => {
      const ids = await seed(5);

      const page = await service.getHistory(channelId, {}, 3);

      expect(page.messages.map((message) => message.id)).toEqual([
        ids[2],
        ids[3],
        ids[4],
      ]);
    });

    it('returns the backwards page oldest → newest', async () => {
      // The repository hands this back newest-first, because that is the
      // order the index holds. The reversal is the service's job, and this is
      // what would notice if someone "fixed" the DESC query instead.
      const ids = await seed(5);

      const page = await service.getHistory(channelId, { before: ids[4] }, 2);

      expect(page.messages.map((message) => message.id)).toEqual([
        ids[2],
        ids[3],
      ]);
    });

    it('returns the forwards page in that same order', async () => {
      const ids = await seed(5);

      const page = await service.getHistory(channelId, { after: ids[1] }, 2);

      expect(page.messages.map((message) => message.id)).toEqual([
        ids[2],
        ids[3],
      ]);
    });

    it('reports hasMore when a row is left in that direction', async () => {
      await seed(4);

      const page = await service.getHistory(channelId, {}, 3);

      expect(page.hasMore).toBe(true);
      expect(page.messages).toHaveLength(3);
    });

    it('reports hasMore false on the last page, exactly at the boundary', async () => {
      // Three rows and a limit of three: the overfetch finds nothing extra,
      // which is the off-by-one this is here to catch.
      await seed(3);

      const page = await service.getHistory(channelId, {}, 3);

      expect(page.hasMore).toBe(false);
      expect(page.messages).toHaveLength(3);
    });

    it('never returns the extra row it fetched to compute hasMore', async () => {
      const ids = await seed(5);

      const page = await service.getHistory(channelId, {}, 2);

      expect(page.messages).toHaveLength(2);
      expect(page.messages.map((message) => message.id)).toEqual([
        ids[3],
        ids[4],
      ]);
    });

    it('computes hasMore for the forwards direction too', async () => {
      const ids = await seed(5);

      const partway = await service.getHistory(channelId, { after: ids[0] }, 2);
      const rest = await service.getHistory(channelId, { after: ids[2] }, 10);

      expect(partway.hasMore).toBe(true);
      expect(rest.hasMore).toBe(false);
    });

    it('returns an empty page with hasMore false in an empty channel', async () => {
      const page = await service.getHistory(channelId, {}, 50);

      expect(page).toEqual({ messages: [], hasMore: false });
    });

    it('skips and repeats nothing when a message arrives mid-scroll', async () => {
      // The point of a Snowflake cursor over an offset. An offset of 2 would
      // return ids[2] twice here, once on each page.
      const ids = await seed(4);
      const first = await service.getHistory(channelId, {}, 2);

      await service.sendMessage(channelId, OWNER_ID, 'arrived mid-scroll');

      const oldest = first.messages[0];
      const second = await service.getHistory(
        channelId,
        { before: oldest?.id },
        2,
      );

      expect(first.messages.map((message) => message.id)).toEqual([
        ids[2],
        ids[3],
      ]);
      expect(second.messages.map((message) => message.id)).toEqual([
        ids[0],
        ids[1],
      ]);
    });
  });
});
