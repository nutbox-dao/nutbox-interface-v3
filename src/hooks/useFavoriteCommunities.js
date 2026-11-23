import { useEffect, useState } from 'react';
import { fetchFavoriteCommunities } from '../config/subgraph';

export function useFavoriteCommunities(addresses, chainId, enabled) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const ids = JSON.stringify(addresses);
  const key = `${chainId}:${ids}`;

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    setResult({ key, loading: true, communities: [], error: false });
    fetchFavoriteCommunities(JSON.parse(ids), chainId, { signal: controller.signal })
      .then(communities => {
        if (!controller.signal.aborted) setResult({ key, loading: false, communities, error: false });
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        console.error('Failed to load favorite communities:', error);
        setResult({ key, loading: false, communities: [], error: true });
      });
    return () => controller.abort();
  }, [chainId, enabled, key, ids, attempt]);

  return {
    ...(result?.key === key ? result : { loading: true, communities: [], error: false }),
    retry: () => setAttempt(value => value + 1),
  };
}
