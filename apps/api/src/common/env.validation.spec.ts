import { EnvironmentVariables, NodeEnv, validate } from './env.validation';

const valid = {
  NODE_ENV: 'development',
  PORT: '3000',
  DATABASE_URL: 'postgresql://huddle:huddle@localhost:5432/huddle',
  REDIS_URL: 'redis://localhost:6379',
  WEB_ORIGIN: 'http://localhost:5173',
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

  it('falls back to defaults for the optional variables', () => {
    const config = validate(omit('PORT', 'WEB_ORIGIN', 'NODE_ENV'));

    expect(config.PORT).toBe(3000);
    expect(config.WEB_ORIGIN).toBe('http://localhost:5173');
    expect(config.NODE_ENV).toBe(NodeEnv.Development);
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
