import { describe, expect, it } from 'vitest';
import { safeServerIconUrl } from './serverIcon';

describe('safeServerIconUrl', () => {
  it('keeps HTTPS icon URLs', () => {
    expect(safeServerIconUrl('https://images.example/icon.png')).toBe(
      'https://images.example/icon.png',
    );
  });

  it('rejects insecure and malformed icon URLs', () => {
    expect(safeServerIconUrl('http://images.example/icon.png')).toBeNull();
    expect(safeServerIconUrl('javascript:alert(1)')).toBeNull();
    expect(safeServerIconUrl('not a URL')).toBeNull();
  });
});
