import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaChannelRepository } from '../src/administration/adapters/prisma-channel-repository.adapter';
import { PrismaServerRepository } from '../src/administration/adapters/prisma-server-repository.adapter';
import { ChannelRepository } from '../src/administration/channel-repository.interface';
import { ServerRepository } from '../src/administration/server-repository.interface';
import { PrismaMessageRepository } from '../src/chat/adapters/prisma-message-repository.adapter';
import { MessageRepository } from '../src/chat/message-repository.interface';
import { NotFoundError } from '../src/common/errors';
import { PrismaService } from '../src/common/prisma.service';
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

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        PrismaService,
        SnowflakeService,
        // Never DATABASE_URL: these cases TRUNCATE, so they must be
        // incapable of reaching the development database.
        { provide: ConfigService, useValue: { get: () => TEST_DATABASE_URL } },
        { provide: ServerRepository, useClass: PrismaServerRepository },
        { provide: ChannelRepository, useClass: PrismaChannelRepository },
        { provide: MessageRepository, useClass: PrismaMessageRepository },
      ],
    }).compile();

    await module.init();
    prisma = module.get(PrismaService);
    messages = module.get(MessageRepository);
    channels = module.get(ChannelRepository);
    servers = module.get(ServerRepository);
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
});
