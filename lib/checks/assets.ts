import type { AssetRef, CheckResult } from '../contracts/types';

// ponytail: copy of isUnknownLicence in lib/assets/pool.ts (lib/checks may not import lib/assets).
const unknown = (license: string): boolean => ['', 'unknown'].includes(license.trim().toLowerCase());

/**
 * Checks that every built asset is in the pool with a known licence, and so is every look font; returns a blocking CheckResult.
 * Never throws.
 */
export const checkLicensed = (
  pool: AssetRef[],
  builtIds: string[],
  fonts: { family: string; license: string }[],
): CheckResult => {
  const problems: string[] = [];
  for (const assetId of builtIds) {
    const asset = pool.find((a) => a.asset_id === assetId);
    if (asset === undefined) problems.push(`asset ${assetId} is not in assets.json`);
    else if (unknown(asset.license)) problems.push(`asset ${assetId} has licence "${asset.license}"`);
  }
  for (const font of fonts) {
    if (unknown(font.license)) problems.push(`font ${font.family} has licence "${font.license}"`);
  }
  const annotations = problems.map((problem) => ({
    problem,
    suggested_fix: 'replace it with a licensed one or record its licence',
  }));
  const count = builtIds.length + fonts.length;
  return {
    id: 'assets.licensed',
    blocking: true,
    status: annotations.length === 0 ? 'pass' : 'fail',
    detail: annotations.length === 0 ? `${count} licences checked` : `${annotations.length} problem(s)`,
    annotations,
  };
};

/**
 * Checks that no scene fragment names a reference-only asset by path or file name; returns a blocking CheckResult.
 * Never throws.
 */
export const checkNoReferenceOnly = (pool: AssetRef[], fragments: Record<string, string>): CheckResult => {
  const annotations: { scene_id: string; problem: string; suggested_fix: string }[] = [];
  const references = pool.filter((a) => a.usage === 'reference_only');
  for (const [scene_id, html] of Object.entries(fragments)) {
    for (const asset of references) {
      const fileName = asset.path.split('/').pop() ?? asset.path;
      if (!html.includes(asset.path) && !html.includes(fileName)) continue;
      annotations.push({
        scene_id,
        problem: `scene ${scene_id} uses reference-only asset ${asset.asset_id} (${asset.path})`,
        suggested_fix: 'use a render asset instead',
      });
    }
  }
  return {
    id: 'assets.no_reference_only',
    blocking: true,
    status: annotations.length === 0 ? 'pass' : 'fail',
    detail:
      annotations.length === 0 ? `${Object.keys(fragments).length} scenes checked` : `${annotations.length} problem(s)`,
    annotations,
  };
};
