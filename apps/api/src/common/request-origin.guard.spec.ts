import { isRequestOriginAllowed } from './request-origin.guard';

describe('request origin policy', () => {
  const webOrigin = 'http://localhost:5173';

  it('accepts a state-changing request from the configured web origin', () => {
    expect(isRequestOriginAllowed('POST', webOrigin, webOrigin)).toBe(true);
  });

  it('rejects missing and untrusted origins on state-changing requests', () => {
    expect(isRequestOriginAllowed('POST', undefined, webOrigin)).toBe(false);
    expect(
      isRequestOriginAllowed('POST', 'https://attacker.example', webOrigin),
    ).toBe(false);
  });

  it('leaves safe methods and OAuth redirects outside the mutation check', () => {
    expect(isRequestOriginAllowed('GET', undefined, webOrigin)).toBe(true);
    expect(isRequestOriginAllowed('OPTIONS', undefined, webOrigin)).toBe(true);
  });
});
