import { useEffect, useState } from 'react';
import { fetchOwnedCommunities } from '../config/subgraph';

export function useOwnedCommunities(account, chainId, enabled, keyword) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [pagination, setPagination] = useState(null);
  const key = JSON.stringify([chainId, account?.toLowerCase(), keyword]);
  const page = pagination?.key === key ? pagination.page : 0;
  const requestKey = JSON.stringify([key, page, attempt]);

  useEffect(() => {
    if (!enabled || !account) return undefined;
    const controller = new AbortController();
    fetchOwnedCommunities(account, chainId, { page, keyword, signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setResult({ requestKey, ...data });
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        console.error('Failed to load wallet communities:', error);
        setResult({ requestKey, communities: [], error: true });
      });
    return () => controller.abort();
  }, [account, chainId, enabled, requestKey, page, keyword]);

  const data = result?.requestKey === requestKey ? result : null;
  return {
    communities: data?.communities ?? [],
    loading: data === null,
    error: data?.error,
    hasMore: data?.hasMore,
    page,
    goToPage: nextPage => setPagination({ key, page: nextPage }),
    retry: () => setAttempt(value => value + 1),
  };
}
