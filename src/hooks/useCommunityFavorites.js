import { useSyncExternalStore } from 'react';

const PREFIX = 'walnut_community_favorites:';
const CHANGE_EVENT = 'walnut-community-favorites-change';
const EMPTY = [];
const cache = new Map();

function readFavorites(chainId) {
  let raw;
  try {
    raw = localStorage.getItem(`${PREFIX}${chainId}`);
  } catch {
    return EMPTY;
  }
  if (cache.get(chainId)?.raw === raw) return cache.get(chainId).value;
  let value = EMPTY;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      value = [...new Set(parsed.filter(id => /^0x[0-9a-f]{40}$/i.test(id)).map(id => id.toLowerCase()))];
    }
  } catch { /* Ignore malformed browser data. */ }
  cache.set(chainId, { raw, value });
  return value;
}

function subscribe(listener) {
  window.addEventListener('storage', listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

export function useCommunityFavorites(chainId) {
  const addresses = useSyncExternalStore(subscribe, () => readFavorites(chainId), () => EMPTY);
  return {
    addresses,
    isFavorite: address => addresses.includes(address?.toLowerCase()),
    toggleFavorite: address => {
      if (!/^0x[0-9a-f]{40}$/i.test(address || '')) return;
      const id = address.toLowerCase();
      const current = readFavorites(chainId);
      const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
      // Let the button report persistence failures instead of claiming success.
      localStorage.setItem(`${PREFIX}${chainId}`, JSON.stringify(next));
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
  };
}
