// Attribute writes for the overlays drawn every frame (src/ui/inset.ts, src/ui/insetControls.ts): an attribute is
// only written when it differs from what this node was last given, so a frame rewrites only what changed.

const written = new WeakMap<object, Record<string, string>>();

/** Sets `name` on `node` unless it already holds `value` from an earlier `put`. */
export function put(node: Element, name: string, value: string | number) {
  const text = String(value);
  const seen = written.get(node) ?? {};
  written.set(node, seen);
  if (seen[name] === text) return;
  seen[name] = text;
  node.setAttribute(name, text);
}
