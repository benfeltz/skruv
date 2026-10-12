// The build's pickable flag (1.9.1): which items this build lets you build, from
// VITE_PICKABLE (CATALOG.pickable). Pure and import-free, so vite.config.ts can check the
// flag against the items/ folders without loading the game or its packs.

/**
 * The pickable set from the build flag (CATALOG.pickable): a comma list of ids, or every one
 * of `ids` when it is empty. An id the game doesn't carry is a broken build flag and throws.
 */
export function pickableSet(flag: string, ids: readonly string[]): ReadonlySet<string> {
  const named = flag.split(',').map((id) => id.trim()).filter(Boolean);
  if (named.length === 0) return new Set(ids);
  const unknown = named.filter((id) => !ids.includes(id));
  if (unknown.length) throw new Error(`pickable names no item: ${unknown.join(', ')} (have: ${ids.join(', ')})`);
  return new Set(named);
}
