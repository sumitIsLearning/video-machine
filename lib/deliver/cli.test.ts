import { expect, test } from 'bun:test';
import { InputError } from '../core/errors';
import { main } from './cli';

test('the CLI refuses unknown commands and extra arguments', async () => {
  for (const argv of [['other', '/r'], ['mix'], ['export', '/r', 'x']])
    await expect(main(argv)).rejects.toThrow(InputError);
});
