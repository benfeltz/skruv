// The pre-splash's page counter (index.html): the catalog's cover and a page per item, as the
// catalog sheet counts them. Pure and import-free, so vite.config.ts can stamp it into the
// page at build time from the items/ folders — the stand-in then never drifts from the
// catalog it hands over to, whatever the next item is.

/** The counter's text for a catalog of `items` items: `1 / 3` for the cover and two items. */
export const splashCount = (items: number) => `1 / ${1 + items}`;

/** `html` with its pre-splash counter's text set for `items` items; any other page is returned as it came. */
export const stampCount = (html: string, items: number) =>
  html.replace(/(<span class="pre-splash-count">)[^<]*(<\/span>)/, (_, open: string, close: string) => `${open}${splashCount(items)}${close}`);
