import { EnvironmentVariables, NodeEnv, validate } from './env.validation';

const valid = {
  NODE_ENV: 'development',
  PORT: '3000',
  DATABASE_URL: 'postgresql://huddle:huddle@localhost:5432/huddle',
  REDIS_URL: 'redis://localhost:6379',
  WEB_ORIGIN: 'http://localhost:5173',
  TRUSTED_PROXY_HOPS: '0',
  LOG_LEVEL: 'info',
  GITHUB_CLIENT_ID: 'test-client-id',
  GITHUB_CLIENT_SECRET: 'test-client-secret',
  GITHUB_CALLBACK_URL: 'http://localhost:3000/auth/github/callback',
  SESSION_SECRET: 'test-session-secret-which-is-at-least-32-characters',
};

describe('validate', () => {
  it('accepts a complete environment and coerces PORT to a number', () => {
    const config = validate(valid);

    expect(config).toBeInstanceOf(EnvironmentVariables);
    expect(config.PORT).toBe(3000);
    expect(typeof config.PORT).toBe('number');
    expect(config.NODE_ENV).toBe(NodeEnv.Development);
    expect(config.DATABASE_URL).toBe(valid.DATABASE_URL);
  });

  it('rejects a missing DATABASE_URL, naming it in the message', () => {
    expect(() => validate(omit('DATABASE_URL'))).toThrow(/DATABASE_URL/);
  });

  it('rejects a missing REDIS_URL, naming it in the message', () => {
    expect(() => validate(omit('REDIS_URL'))).toThrow(/REDIS_URL/);
  });

  it('rejects a missing GITHUB_CLIENT_ID, naming it in the message', () => {
    expect(() => validate(omit('GITHUB_CLIENT_ID'))).toThrow(
      /GITHUB_CLIENT_ID/,
    );
  });

  it('rejects a missing GITHUB_CLIENT_SECRET, naming it in the message', () => {
    expect(() => validate(omit('GITHUB_CLIENT_SECRET'))).toThrow(
      /GITHUB_CLIENT_SECRET/,
    );
  });

  it('rejects a missing GITHUB_CALLBACK_URL, naming it in the message', () => {
    expect(() => validate(omit('GITHUB_CALLBACK_URL'))).toThrow(
      /GITHUB_CALLBACK_URL/,
    );
  });

  it('rejects a missing SESSION_SECRET, naming it in the message', () => {
    expect(() => validate(omit('SESSION_SECRET'))).toThrow(/SESSION_SECRET/);
  });

  it('rejects an empty DATABASE_URL rather than treating it as absent', () => {
    expect(() => validate({ ...valid, DATABASE_URL: '' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects a PORT that is not a number', () => {
    expect(() => validate({ ...valid, PORT: 'notanumber' })).toThrow(/PORT/);
  });

  it('rejects a PORT outside the valid range', () => {
    expect(() => validate({ ...valid, PORT: '70000' })).toThrow(/PORT/);
  });

  it('rejects an unrecognised NODE_ENV', () => {
    expect(() => validate({ ...valid, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });

  it('reports every offending variable at once, not just the first', () => {
    const message = expectThrownMessage(() =>
      validate({ ...valid, PORT: 'notanumber', NODE_ENV: 'staging' }),
    );

    expect(message).toMatch(/PORT/);
    expect(message).toMatch(/NODE_ENV/);
  });

  it('rejects missing runtime configuration instead of using implicit defaults', () => {
    const message = expectThrownMessage(() =>
      validate(
        omit(
          'PORT',
          'WEB_ORIGIN',
          'NODE_ENV',
          'TRUSTED_PROXY_HOPS',
          'LOG_LEVEL',
        ),
      ),
    );

    expect(message).toMatch(/PORT/);
    expect(message).toMatch(/WEB_ORIGIN/);
    expect(message).toMatch(/NODE_ENV/);
    expect(message).toMatch(/TRUSTED_PROXY_HOPS/);
    expect(message).toMatch(/LOG_LEVEL/);
  });

  it('coerces TRUSTED_PROXY_HOPS to a number', () => {
    const config = validate({ ...valid, TRUSTED_PROXY_HOPS: '2' });

    expect(config.TRUSTED_PROXY_HOPS).toBe(2);
    expect(typeof config.TRUSTED_PROXY_HOPS).toBe('number');
  });

  it('rejects a TRUSTED_PROXY_HOPS that is not a number', () => {
    expect(() => validate({ ...valid, TRUSTED_PROXY_HOPS: 'true' })).toThrow(
      /TRUSTED_PROXY_HOPS/,
    );
  });

  it('rejects a negative TRUSTED_PROXY_HOPS', () => {
    expect(() => validate({ ...valid, TRUSTED_PROXY_HOPS: '-1' })).toThrow(
      /TRUSTED_PROXY_HOPS/,
    );
  });

  it('rejects a fractional TRUSTED_PROXY_HOPS, which is not a hop count', () => {
    expect(() => validate({ ...valid, TRUSTED_PROXY_HOPS: '1.5' })).toThrow(
      /TRUSTED_PROXY_HOPS/,
    );
  });

  it('ignores variables it does not declare', () => {
    const config = validate({ ...valid, SOME_UNRELATED_SHELL_VAR: 'noise' });

    expect(config.DATABASE_URL).toBe(valid.DATABASE_URL);
  });
});

function omit(...keys: (keyof typeof valid)[]): Record<string, string> {
  const config: Record<string, string> = { ...valid };

  for (const key of keys) {
    delete config[key];
  }

  return config;
}

function expectThrownMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error('expected the call to throw, but it returned');
}
