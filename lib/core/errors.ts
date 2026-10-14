/** Base class of every error the Video Machine throws on purpose. */
export class VideoMachineError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** A run-folder file does not match its schema, or is not JSON at all. */
export class ContractError extends VideoMachineError {}

/** The creator's input can't be used (a missing file, a path outside the run folder, a value with no default). The message says what to fix. */
export class InputError extends VideoMachineError {}

/** The capture browser could not be opened or driven. The message names the profile and what to run. */
export class CaptureError extends VideoMachineError {}

/** The caller asked for something this adapter does not do (never faked). */
export class UnsupportedError extends VideoMachineError {}

/** A child process failed, could not start, or timed out. */
export class ToolError extends VideoMachineError {
  readonly cmd: string[];
  readonly code: number | null;
  readonly stderrTail: string;
  readonly timedOut: boolean;

  /** Build the error from the command, its exit code (null if none) and stderr; only the last 2048 chars are kept. */
  constructor(o: { cmd: string[]; code: number | null; stderr: string; timedOut?: boolean }, options?: ErrorOptions) {
    const stderrTail = o.stderr.slice(-2048);
    const how = o.timedOut ? 'timed out' : `exit ${o.code ?? 'none'}`;
    super(`${how}: ${o.cmd.join(' ')}\n${stderrTail}`.trimEnd(), options);
    this.cmd = o.cmd;
    this.code = o.code;
    this.stderrTail = stderrTail;
    this.timedOut = o.timedOut ?? false;
  }
}
