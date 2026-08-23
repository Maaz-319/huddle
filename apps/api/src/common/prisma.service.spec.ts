import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  const get = jest.fn().mockReturnValue('postgresql://huddle:huddle@db:5432/x');
  let service: PrismaService;

  beforeEach(async () => {
    get.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService, { provide: ConfigService, useValue: { get } }],
    }).compile();

    service = module.get(PrismaService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('takes its connection string from ConfigService, not process.env', () => {
    expect(get).toHaveBeenCalledWith('DATABASE_URL', { infer: true });
  });

  it('connects on module init', async () => {
    const connect = jest.spyOn(service, '$connect').mockResolvedValue();

    await service.onModuleInit();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('disconnects on module destroy', async () => {
    const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue();

    await service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
