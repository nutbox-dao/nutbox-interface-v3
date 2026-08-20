// Renderers in this list produce their final artwork without a random seed.
// Add future audited seed-independent renderers here.
export const INDEX_BROKER_SEEDLESS_RENDERERS = Object.freeze([
  '0x10347430eD726bfcC0ae65Ae8988732A62f04Ad8',
]);

const SEEDLESS_RENDERER_SET = new Set(
  INDEX_BROKER_SEEDLESS_RENDERERS.map(address => address.toLowerCase()),
);

export function indexBrokerRendererRequiresSeed(address) {
  const normalized = String(address || '').trim().toLowerCase();
  return Boolean(normalized) && !SEEDLESS_RENDERER_SET.has(normalized);
}
