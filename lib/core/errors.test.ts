import { expect, test } from 'bun:test';
import { ContractError, InputError, ToolError, UnsupportedError, VideoMachineError } from './errors';

test('subclasses are VideoMachineErrors and carry their own name', () => {
  for (const e of [new ContractError('x'), new UnsupportedError('y')]) {
    expect(e).toBeInstanceOf(VideoMachineError);
    expect(e).toBeInstanceOf(Error);
  }
  expect(new ContractError('x').name).toBe('ContractError');
  expect(new UnsupportedError('y').name).toBe('UnsupportedError');
});

test('errors keep their cause', () => {
  const cause = new SyntaxError('bad');
  expect(new ContractError('wrap', { cause }).cause).toBe(cause);
});

test('ToolError keeps the command, exit code and only the last 2 KB of stderr', () => {
  const e = new ToolError({ cmd: ['ffmpeg', '-i', 'x.mp4'], code: 3, stderr: `${'a'.repeat(5000)}END` });
  expect(e.name).toBe('ToolError');
  expect(e.cmd).toEqual(['ffmpeg', '-i', 'x.mp4']);
  expect(e.code).toBe(3);
  expect(e.timedOut).toBe(false);
  expect(e.stderrTail.length).toBe(2048);
  expect(e.stderrTail.endsWith('END')).toBe(true);
  expect(e.message).toContain('ffmpeg -i x.mp4');
  expect(e.message).toContain('exit 3');
});

test('InputError is a VideoMachineError named InputError', () => {
  const e = new InputError('concept is empty');
  expect(e).toBeInstanceOf(VideoMachineError);
  expect(e.name).toBe('InputError');
  expect(e.message).toBe('concept is empty');
});

test('ToolError says when the command timed out', () => {
  const e = new ToolError({ cmd: ['hyperframes', 'render'], code: null, stderr: '', timedOut: true });
  expect(e.timedOut).toBe(true);
  expect(e.message).toContain('timed out');
});
