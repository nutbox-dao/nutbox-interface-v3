import { useEffect, useState } from 'react';
import { fetchOwnedCommunities } from '../config/subgraph';

export function useOwnedCommunities(account, chainId, enabled) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${chainId}:${account?.toLowerCase()}`;

  useEffect(() => {
    if (!enabled || !account) return undefined;
    const controller = new AbortController();
    setResult({ key, loading: true, communities: [], error: false });
    fetchOwnedCommunities(account, chainId, { signal: controller.signal })
      .then(communities => {
        if (!controller.signal.aborted) setResult({ key, loading: false, communities, error: false });
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        console.error('Failed to load wallet communities:', error);
        setResult({ key, loading: false, communities: [], error: true });
      });
    return () => controller.abort();
  }, [account, chainId, enabled, key, attempt]);

  return {
    ...(result?.key === key ? result : { loading: true, communities: [], error: false }),
    retry: () => setAttempt(value => value + 1),
  };
}
