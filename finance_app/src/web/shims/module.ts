/** `node:module` is not available in the browser; the web build loads SQLite through setSqlLoader. */
export function createRequire(): never {
  throw new Error('require() is not available in the browser build');
}
export default { createRequire };
