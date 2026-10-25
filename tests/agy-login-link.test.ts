import { describe, expect, it } from 'vitest';
import { agyLoginLink } from '../src/agy-login-link';
describe('console login links', () => {
  it('accepts Google login HTTPS links and rejects executable or deceptive addresses', () => {
    expect(agyLoginLink('https://accounts.google.com/o/oauth2/auth?client_id=test')).toContain(
      'accounts.google.com',
    );
    for (const value of [
      'javascript:alert(1)',
      'http://accounts.google.com/',
      'https://accounts.google.com.evil.test/',
      'https://accounts.google.com@evil.test/',
      'https://evil.test@accounts.google.com/',
      'https://accounts.google.com:444/',
      'file:///etc/passwd',
    ])
      expect(agyLoginLink(value)).toBeUndefined();
  });
});
