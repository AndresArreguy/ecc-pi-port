/**
 * Resolve hook used by the extension registration tests: Pi owns these peer
 * packages at runtime, so tests map them to local stubs instead of installing
 * a second copy of the TUI.
 */

const STUBS = {
  "@earendil-works/pi-tui": new URL("./pi-tui-stub.mjs", import.meta.url).href,
  "@earendil-works/pi-coding-agent": new URL("./pi-coding-agent-stub.mjs", import.meta.url).href,
};

export async function resolve(specifier, context, nextResolve) {
  const stub = STUBS[specifier];
  if (stub) return { url: stub, shortCircuit: true };
  return nextResolve(specifier, context);
}
