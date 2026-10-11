import { expect, test } from 'bun:test';
import { InputError } from './errors';
import { assertPublicHttpUrl, isPrivateHost } from './url';

test.each([
  'not a url',
  'file:///C:/secret.txt',
  'data:text/plain,hi',
  'ftp://example.com/x',
  'https://user:pw@example.com/',
  'https://user@example.com/',
  'http://localhost/',
  'http://LOCALHOST:3000/',
  'http://app.localhost/',
  'http://127.0.0.1/',
  'http://127.9.9.9:8080/',
  'http://[::1]/',
  'http://10.1.2.3/',
  'http://172.16.0.1/',
  'http://172.31.255.255/',
  'http://192.168.1.1/',
  'http://[fc00::1]/',
  'http://[fd12:3456::1]/',
  'http://169.254.169.254/latest/meta-data',
  'http://[fe80::1]/',
  'http://[febf::1]/',
  'http://2130706433/', // 127.0.0.1 written as one number
])('assertPublicHttpUrl refuses %s', (url) => {
  expect(() => assertPublicHttpUrl(url, 'download')).toThrow(InputError);
});

test.each(['http://172.32.0.1/', 'http://192.169.0.1/', 'http://11.0.0.1/', 'http://[2001:db8::1]/'])(
  'assertPublicHttpUrl allows the public address %s',
  (url) => {
    expect(assertPublicHttpUrl(url, 'download').href).toBe(url);
  },
);

test('the refusal names what was being fetched and never echoes a password', () => {
  const err = (() => {
    try {
      assertPublicHttpUrl('https://user:hunter2@example.com/', 'page capture');
    } catch (e) {
      return e as Error;
    }
  })();
  expect(err?.message).toContain('page capture');
  expect(err?.message).not.toContain('hunter2');
});

test('isPrivateHost tells loopback from public hosts', () => {
  expect(isPrivateHost('127.0.0.1')).toBe(true);
  expect(isPrivateHost('[::ffff:7f00:1]')).toBe(true);
  expect(isPrivateHost('example.com')).toBe(false);
});
