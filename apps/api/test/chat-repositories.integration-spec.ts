import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaChannelMemberRepository } from '../src/administration/adapters/prisma-channel-member-repository.adapter';
import { PrismaChannelOverrideRepository } from '../src/administration/adapters/prisma-channel-override-repository.adapter';
import { PrismaChannelRepository } from '../src/administration/adapters/prisma-channel-repository.adapter';
import { PrismaMembershipRepository } from '../src/administration/adapters/prisma-membership-repository.adapter';
import { PrismaServerRepository } from '../src/administration/adapters/prisma-server-repository.adapter';
import { ChannelMemberRepository } from '../src/administration/channel-member-repository.interface';
import { ChannelOverrideRepository } from '../src/administration/channel-override-repository.interface';
import { ChannelRepository } from '../src/administration/channel-repository.interface';
import { MembershipRepository } from '../src/administration/membership-repository.interface';
import { ServerRepository } from '../src/administration/server-repository.interface';
import { PrismaMessageRepository } from '../src/chat/adapters/prisma-message-repository.adapter';
import { ChatService } from '../src/chat/chat.service';
import { MessageRepository } from '../src/chat/message-repository.interface';
import { NotFoundError } from '../src/common/errors';
import { PrismaService } from '../src/common/prisma.service';
import { LoggerService } from '../src/common/logger.service';
import { SnowflakeService } from '../src/common/snowflake.service';
import {
  describeMessageRepositoryContract,
  MESSAGE_AUTHOR_ID,
  MESSAGE_OTHER_AUTHOR_ID,
} from './fakes/message-repository.contract';
import { TEST_DATABASE_URL, truncateAll } from './prisma-test-client';

/** A minimal, valid `User` row for a given id — Message's FK just needs it to exist. */
function userFixture(id: bigint) {
  return {
    id,
    githubId: id.toString(),
    username: `user-${id}`,
    avatarUrl: 'https://example.test/avatar.png',
    email: `user-${id}@example.test`,
  };
}

/**
 * The chat adapters against real Docker Postgres.
 *
 * A file of its own rather than more of `administration-repositories.integration-spec.ts`:
 * the suites there are scoped to one module's ports, and messages are the
 * Chat module's. `ChannelRepository` and `ServerRepository` appear only
 * because a `Message` cannot exist without a channel and a server to hang it
 * off — the contract needs them to build its fixture, not to test them.
 */
describe('the chat Prisma adapters', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let messages: MessageRepository;
  let channels: ChannelRepository;
  let servers: ServerRepository;
  let memberships: MembershipRepository;
  let channelMembers: ChannelMemberRepository;
  let channelOverrides: ChannelOverrideRepository;

  beforeAll(async () => {
    const mockLogger = {
      error: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      trace: jest.fn(),
      fatal: jest.fn(),
      setCorrelationId: jest.fn(),
      clearCorrelationId: jest.fn(),
      child: jest.fn(),
    } as unknown as LoggerService;

    module = await Test.createTestingModule({
      providers: [
        PrismaService,
        SnowflakeService,
        { provide: LoggerService, useValue: mockLogger },
        // Never DATABASE_URL: these cases TRUNCATE, so they must be
        // incapable of reaching the development database.
        { provide: ConfigService, useValue: { get: () => TEST_DATABASE_URL } },
        { provide: ServerRepository, useClass: PrismaServerRepository },
        { provide: ChannelRepository, useClass: PrismaChannelRepository },
        { provide: MessageRepository, useClass: PrismaMessageRepository },
        { provide: MembershipRepository, useClass: PrismaMembershipRepository },
        {
          provide: ChannelMemberRepository,
          useClass: PrismaChannelMemberRepository,
        },
        {
          provide: ChannelOverrideRepository,
          useClass: PrismaChannelOverrideRepository,
        },
      ],
    }).compile();

    await module.init();
    prisma = module.get(PrismaService);
    messages = module.get(MessageRepository);
    channels = module.get(ChannelRepository);
    servers = module.get(ServerRepository);
    memberships = module.get(MembershipRepository);
    channelMembers = module.get(ChannelMemberRepository);
    channelOverrides = module.get(ChannelOverrideRepository);
  });

  afterAll(async () => {
    await module.close();
  });

  it('resolves the port token to the Prisma adapter', () => {
    expect(messages).toBeInstanceOf(PrismaMessageRepository);
  });

  describeMessageRepositoryContract('PrismaMessageRepository', async () => {
    await truncateAll(prisma);
    // Message.authorId is a real foreign key, unlike the fake, so both
    // authors the cases post as have to actually exist first.
    await prisma.user.createMany({
      data: [
        userFixture(MESSAGE_AUTHOR_ID),
        userFixture(MESSAGE_OTHER_AUTHOR_ID),
      ],
    });
    return { messages, channels, servers };
  });

  describe('behaviour that needs a real database', () => {
    beforeEach(async () => {
      await truncateAll(prisma);
      await prisma.user.create({ data: userFixture(MESSAGE_AUTHOR_ID) });
    });

    it('turns a deleted channel into a NotFoundError rather than a 500', async () => {
      // The `P2003` mapping, exercised the way it actually happens: the guard
      // has already read the channel, and it is gone by the time the insert
      // lands. A `Map`-backed fake cannot produce a foreign key violation, so
      // this case can only live here.
      const { server } = await servers.createWithOwner(
        {
          name: 'Huddle HQ',
          iconUrl: null,
          channelCreationPolicy: 'everyone',
          memberInviteToggle: true,
        },
        MESSAGE_AUTHOR_ID,
      );
      const channel = await channels.create({
        serverId: server.id,
        name: 'general',
        isPrivate: false,
      });
      await channels.delete(channel.id);

      await expect(
        messages.create({
          channelId: channel.id,
          authorId: MESSAGE_AUTHOR_ID,
          content: 'too late',
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('takes its messages with the channel, through the schema cascade', async () => {
      // `Message.channel` is `onDelete: Cascade` (data-model.md section 7) and
      // nothing in the application deletes messages when a channel goes. If
      // the cascade were ever dropped from the schema, this is what notices.
      const { server } = await servers.createWithOwner(
        {
          name: 'Huddle HQ',
          iconUrl: null,
          channelCreationPolicy: 'everyone',
          memberInviteToggle: true,
        },
        MESSAGE_AUTHOR_ID,
      );
      const channel = await channels.create({
        serverId: server.id,
        name: 'general',
        isPrivate: false,
      });
      const message = await messages.create({
        channelId: channel.id,
        authorId: MESSAGE_AUTHOR_ID,
        content: 'goes with the channel',
      });

      await channels.delete(channel.id);

      await expect(messages.findById(message.id)).resolves.toBeNull();
    });
  });

  /**
   * One page must cost a fixed number of reads whatever the page size — the
   * `@@index([channelId, id])` index does the paging, and a per-message
   * follow-up read would not show up in the contract suite at all, only in
   * the latency of a real channel.
   *
   * `jest.spyOn` on the adapter instance rather than a counting wrapper: it
   * counts the same thing with nothing new to keep in step with the port.
   * Same idiom as the channel listing's own bounded-reads suite in
   * `administration-repositories.integration-spec.ts`.
   */
  describe('one page of history is a bounded number of reads', () => {
    let service: ChatService;
    let channelId: bigint;

    beforeEach(async () => {
      await truncateAll(prisma);
      await prisma.user.create({ data: userFixture(MESSAGE_AUTHOR_ID) });
      const { server } = await servers.createWithOwner(
        {
          name: 'Huddle HQ',
          iconUrl: null,
          channelCreationPolicy: 'everyone',
          memberInviteToggle: true,
        },
        MESSAGE_AUTHOR_ID,
      );
      const channel = await channels.create({
        serverId: server.id,
        name: 'general',
        isPrivate: false,
      });
      channelId = channel.id;
      service = new ChatService(
        messages,
        channels,
        memberships,
        channelMembers,
        channelOverrides,
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function seedMessages(count: number): Promise<void> {
      for (let index = 0; index < count; index += 1) {
        await messages.create({
          channelId,
          authorId: MESSAGE_AUTHOR_ID,
          content: `message ${index}`,
        });
      }
    }

    it.each([[5], [50]])('reads once for a page of %i', async (limit) => {
      await seedMessages(limit * 2);
      const before = jest.spyOn(messages, 'findPageBefore');
      const byId = jest.spyOn(messages, 'findById');

      const page = await service.getHistory(channelId, {}, limit);

      expect(page.messages).toHaveLength(limit);
      expect(before).toHaveBeenCalledTimes(1);
      // The N+1 this rules out: a per-message read to fill in the response.
      expect(byId).not.toHaveBeenCalled();
    });

    it('reads once for a forwards page too', async () => {
      await seedMessages(60);
      const first = await service.getHistory(channelId, {}, 50);
      const oldest = first.messages[0];
      const after = jest.spyOn(messages, 'findPageAfter');
      const byId = jest.spyOn(messages, 'findById');

      await service.getHistory(channelId, { after: oldest?.id }, 50);

      expect(after).toHaveBeenCalledTimes(1);
      expect(byId).not.toHaveBeenCalled();
    });

    it('asks for exactly one row beyond the page, never a count', async () => {
      // hasMore must not cost a second scan of the same index.
      await seedMessages(60);
      const before = jest.spyOn(messages, 'findPageBefore');

      await service.getHistory(channelId, {}, 50);

      expect(before).toHaveBeenCalledWith(channelId, null, 51);
    });

    it('keeps a soft-deleted message in the page, and counts it', async () => {
      // A Map-backed fake would agree either way; this proves the real query
      // has no `isDeleted: false` filter quietly added to it.
      await seedMessages(4);
      const page = await service.getHistory(channelId, {}, 50);
      const victim = page.messages[1];
      if (victim === undefined) throw new Error('No message to delete');

      await prisma.message.update({
        where: { id: victim.id },
        data: { content: '', isDeleted: true, deletedAt: new Date() },
      });

      const after = await service.getHistory(channelId, {}, 50);

      expect(after.messages).toHaveLength(4);
      expect(after.messages[1]).toMatchObject({
        id: victim.id,
        isDeleted: true,
      });
    });
  });
});
