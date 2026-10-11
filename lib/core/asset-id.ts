import { createHash } from 'node:crypto';
import type { AssetRef } from '../contracts/types';

/**
 * The stable id of an asset: its origin plus the first 8 hex of sha1(key), so the creator's pin and drop marks survive a rebuild.
 * Returns e.g. `found-1a2b3c4d`; throws nothing.
 */
export const assetIdOf = (origin: AssetRef['origin'], key: string): string =>
  `${origin}-${createHash('sha1').update(key).digest('hex').slice(0, 8)}`;
