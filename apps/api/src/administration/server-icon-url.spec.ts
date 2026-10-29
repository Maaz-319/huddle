import { validate } from 'class-validator';
import { CreateServerDto } from './create-server.dto';
import { UpdateServerDto } from './update-server.dto';

describe('server icon URL validation', () => {
  it('accepts HTTPS icon URLs', async () => {
    const create = Object.assign(new CreateServerDto(), {
      name: 'Example',
      iconUrl: 'https://images.example/icon.png',
    });
    const update = Object.assign(new UpdateServerDto(), {
      iconUrl: 'https://images.example/icon.png',
    });

    await expect(validate(create)).resolves.toEqual([]);
    await expect(validate(update)).resolves.toEqual([]);
  });

  it('rejects non-HTTPS icon URLs', async () => {
    const create = Object.assign(new CreateServerDto(), {
      name: 'Example',
      iconUrl: 'http://images.example/icon.png',
    });
    const update = Object.assign(new UpdateServerDto(), {
      iconUrl: 'javascript:alert(1)',
    });

    await expect(validate(create)).resolves.not.toEqual([]);
    await expect(validate(update)).resolves.not.toEqual([]);
  });
});
