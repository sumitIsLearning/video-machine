import { type Config, loadConfig } from './config';
import { type Sh, sh } from './sh';

/** What an adapter needs from the outside world; tests pass a fake `sh` and a config built from a fake env. */
export type Deps = { sh: Sh; config: Config };

/**
 * The real dependencies: the process runner and the settings read from the process environment.
 * Returns a new `Deps`; throws nothing.
 */
export const defaultDeps = (): Deps => ({ sh, config: loadConfig() });
