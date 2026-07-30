import { useCallback, useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { Link } from 'react-router-dom';
import { useWeb3 } from '../../contexts/Web3Context';
import { useToast } from '../../contexts/ToastContext';
import { useLanguage } from '../../contexts/LanguageContext';
import {
  BasketStakePoolABI,
  BasketTVLMiningPoolABI,
  CommitteeABI,
  ERC20ABI,
  NFTMiningPoolABI,
} from '../../config/abis';
import { getChainPath } from '../../config/contracts';
import {
  fetchBasketChildLive,
  fetchBasketMiningPool,
  fetchNftMiningNfts,
  registerBasketChildPool,
} from '../../config/subgraph';
import {
  formatDuration,
  formatTokenAmount,
  getPoolTypeBadgeClass,
} from '../../utils/helpers';
import { multicallRead } from '../../utils/multicall';
import { PoolCardFooter, PoolCardHeader } from './PoolCardTemplate';
import BasketStakePoolCard from './BasketStakePoolCard';
import './BasketTVLMiningPoolCard.css';

const MAX_BASKET_POOLS_PER_NFT = 3;
const NAV_MATCH_THRESHOLD_BPS = 100n;
const NAV_REFRESH_THRESHOLD_BPS = 500n;

function toBigInt(value, fallback = 0n) {
  try {
    return value === null || value === undefined || value === '' ? fallback : BigInt(value);
  } catch {
    return fallback;
  }
}

function getNavStatus(miningAmount, actualNav) {
  if (actualNav === null || actualNav === undefined) return 'unknown';
  if (miningAmount === actualNav) return 'matched';
  if (miningAmount === 0n) return actualNav > 0n ? 'stale' : 'matched';
  const difference = miningAmount > actualNav
    ? miningAmount - actualNav
    : actualNav - miningAmount;
  const differenceBps = difference * 10000n;
  if (differenceBps < miningAmount * NAV_MATCH_THRESHOLD_BPS) return 'matched';
  if (differenceBps < miningAmount * NAV_REFRESH_THRESHOLD_BPS) return 'warning';
  return 'stale';
}

export default function BasketTVLMiningPoolCard({
  pool,
  communityAddress,
  communityToken,
  initialData,
  detail = false,
}) {
  const { account, signer, readProvider, isConnected, connecting, connect, contracts, network } = useWeb3();
  const toast = useToast();
  const { t } = useLanguage();

  const [poolConfig, setPoolConfig] = useState({
    name: initialData?.name || pool.name || t('basketPool.fallbackName'),
    nftMiningPool: initialData?.nftMiningPool || '',
    lockDuration: initialData?.lockDuration || 0n,
    nftRewardBps: initialData?.nftRewardBps || 0,
  });
  const [totalNav, setTotalNav] = useState(initialData?.totalNav || 0n);
  const [basketStakes, setBasketStakes] = useState([]);
  const [childDataByBasket, setChildDataByBasket] = useState({});
  const [basketCount, setBasketCount] = useState(0);
  const [ownedNftIds, setOwnedNftIds] = useState([]);
  const [nftBasketPoolCounts, setNftBasketPoolCounts] = useState({});
  const [operationFee, setOperationFee] = useState(initialData?.operationFee || 0n);
  const [loading, setLoading] = useState(!initialData);
  const [childrenLoading, setChildrenLoading] = useState(detail);
  const [childrenError, setChildrenError] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [basketAddress, setBasketAddress] = useState('');
  const [nftTokenId, setNftTokenId] = useState('');
  const [basketPreview, setBasketPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState('');

  const loadParentData = useCallback(async () => {
    if (!readProvider) return;
    try {
      const committeeInterface = new ethers.Interface(CommitteeABI);
      const [indexed, feeData] = await Promise.all([
        fetchBasketMiningPool(pool.id, network.id),
        detail
          ? multicallRead(readProvider, contracts.Multicall3, [
            { key: 'operationFee', target: contracts.Committee, contractInterface: committeeInterface, functionName: 'getPoolOperationFee' },
          ])
          : Promise.resolve({ operationFee: 0n }),
      ]);
      if (!indexed) throw new Error('Basket TVL pool is not indexed');
      setPoolConfig({
        name: indexed.name,
        nftMiningPool: indexed.nftMiningPool,
        lockDuration: toBigInt(indexed.lockDuration),
        nftRewardBps: Number(indexed.nftRewardBps || 0),
      });
      setTotalNav(toBigInt(indexed.totalMiningAmount));
      setBasketCount(Number(indexed.basketCount || indexed.children?.length || 0));
      setOperationFee(feeData.operationFee || 0n);
    } catch (error) {
      console.error('Failed to load Basket TVL parent pool:', error);
    } finally {
      setLoading(false);
    }
  }, [contracts.Committee, contracts.Multicall3, detail, network.id, pool.id, readProvider]);

  useEffect(() => {
    if (initialData) {
      setPoolConfig({
        name: initialData.name,
        nftMiningPool: initialData.nftMiningPool,
        lockDuration: initialData.lockDuration,
        nftRewardBps: initialData.nftRewardBps,
      });
      setTotalNav(initialData.totalNav);
      setOperationFee(initialData.operationFee);
      setLoading(false);
    } else {
      loadParentData();
    }
    const timer = setInterval(loadParentData, 15000);
    return () => clearInterval(timer);
  }, [initialData, loadParentData]);

  const loadChildren = useCallback(async () => {
    if (!readProvider) return;
    setChildrenLoading(true);
    setChildrenError(false);
    try {
      const indexedParent = await fetchBasketMiningPool(pool.id, network.id);
      if (!indexedParent) throw new Error('Basket TVL pool is not indexed');
      const indexedChildrenByBasket = new Map(
        (indexedParent.children || []).map(child => [child.basket.toLowerCase(), child]),
      );
      const childrenByBasket = new Map();
      (indexedParent.stakes || []).forEach(stake => {
        const indexedChild = indexedChildrenByBasket.get(stake.basket.toLowerCase()) || {};
        childrenByBasket.set(stake.basket.toLowerCase(), {
          basket: ethers.getAddress(stake.basket),
          childPool: ethers.getAddress(stake.childPool || indexedChild.childPool),
          basketCreator: stake.creator || indexedChild.basketCreator || '',
          nftTokenId: toBigInt(stake.nftTokenId ?? indexedChild.nftTokenId),
          miningAmount: toBigInt(stake.miningAmount),
          updatedAt: toBigInt(stake.chainUpdatedAt ?? stake.updatedAt),
          totalStakedAmount: toBigInt(indexedChild.totalStakedAmount),
        });
      });
      indexedChildrenByBasket.forEach((child, key) => {
        if (childrenByBasket.has(key)) return;
        childrenByBasket.set(key, {
          basket: ethers.getAddress(child.basket),
          childPool: ethers.getAddress(child.childPool),
          basketCreator: child.basketCreator || '',
          nftTokenId: toBigInt(child.nftTokenId),
          miningAmount: 0n,
          updatedAt: toBigInt(child.updatedAt),
          totalStakedAmount: toBigInt(child.totalStakedAmount),
        });
      });
      const children = [...childrenByBasket.values()];
      setBasketCount(children.length);
      if (!detail || children.length === 0) {
        setBasketStakes([]);
        setChildDataByBasket({});
        return;
      }

      const parentInterface = new ethers.Interface(BasketTVLMiningPoolABI);
      const childInterface = new ethers.Interface(BasketStakePoolABI);
      const tokenInterface = new ethers.Interface(ERC20ABI);
      const nftInterface = new ethers.Interface(NFTMiningPoolABI);
      const calls = [];

      if (contracts.WETH) {
        calls.push(
          { key: 'holderSymbol', target: contracts.WETH, contractInterface: tokenInterface, functionName: 'symbol', allowFailure: true },
          { key: 'holderDecimals', target: contracts.WETH, contractInterface: tokenInterface, functionName: 'decimals', allowFailure: true },
        );
      }

      children.forEach(child => {
        const key = child.basket.toLowerCase();
        calls.push(
          { key: `${key}:actualNav`, target: pool.id, contractInterface: parentInterface, functionName: 'basketNavWeth', args: [child.basket], allowFailure: true },
          { key: `${key}:name`, target: child.basket, contractInterface: tokenInterface, functionName: 'name', allowFailure: true },
          { key: `${key}:symbol`, target: child.basket, contractInterface: tokenInterface, functionName: 'symbol', allowFailure: true },
          { key: `${key}:decimals`, target: child.basket, contractInterface: tokenInterface, functionName: 'decimals', allowFailure: true },
          { key: `${key}:pendingNftRewards`, target: child.childPool, contractInterface: childInterface, functionName: 'pendingNftRewards', allowFailure: true },
        );
        if (ethers.isAddress(poolConfig.nftMiningPool)) {
          calls.push({
            key: `${key}:nftOwner`,
            target: poolConfig.nftMiningPool,
            contractInterface: nftInterface,
            functionName: 'ownerOf',
            args: [child.nftTokenId],
            allowFailure: true,
          });
        }
        if (account) {
          calls.push(
            { key: `${key}:userBalance`, target: child.basket, contractInterface: tokenInterface, functionName: 'balanceOf', args: [account], allowFailure: true },
            { key: `${key}:allowance`, target: child.basket, contractInterface: tokenInterface, functionName: 'allowance', args: [account, child.childPool], allowFailure: true },
          );
        }
      });

      const [data, liveResults] = await Promise.all([
        multicallRead(readProvider, contracts.Multicall3, calls),
        account
          ? Promise.all(children.map(child => (
            fetchBasketChildLive(child.childPool, account, network.id).catch(() => null)
          )))
          : Promise.resolve(children.map(() => null)),
      ]);
      const liveByChildPool = new Map(children.map((child, index) => [
        child.childPool.toLowerCase(),
        liveResults[index],
      ]));
      const holderFeeInfo = {
        address: contracts.WETH,
        symbol: data.holderSymbol || 'WETH',
        decimals: Number(data.holderDecimals || 18),
      };
      const stakes = children
        .map(child => {
          const key = child.basket.toLowerCase();
          const actualNav = data[`${key}:actualNav`];
          const navStatus = getNavStatus(child.miningAmount, actualNav);
          return {
            basket: child.basket,
            basketCreator: child.basketCreator,
            childPool: child.childPool,
            nftTokenId: child.nftTokenId,
            miningAmount: child.miningAmount,
            actualNav,
            navStatus,
            navNeedsRefresh: navStatus === 'stale',
            updatedAt: child.updatedAt,
            totalStakedAmount: child.totalStakedAmount,
            exists: true,
          };
        })
        .filter(stake => stake.exists)
        .sort((a, b) => {
          if (a.miningAmount === b.miningAmount) return 0;
          return a.miningAmount > b.miningAmount ? -1 : 1;
        });
      setBasketStakes(stakes);
      setBasketCount(stakes.length);
      setChildDataByBasket(Object.fromEntries(stakes.map(stake => {
        const key = stake.basket.toLowerCase();
        const liveResult = liveByChildPool.get(stake.childPool.toLowerCase());
        const live = liveResult?.live;
        return [key, {
          tokenInfo: {
            address: stake.basket,
            name: data[`${key}:name`] || '',
            symbol: data[`${key}:symbol`] || 'BASKET',
            decimals: Number(data[`${key}:decimals`] || 18),
          },
          holderFeeInfo,
          totalStaked: stake.totalStakedAmount,
          userStaked: toBigInt(live?.userInfo?.amount),
          userBalance: data[`${key}:userBalance`] || 0n,
          allowance: data[`${key}:allowance`] || 0n,
          pendingRewards: toBigInt(live?.pendingRewards),
          pendingHolderFees: toBigInt(live?.pendingHolderFees),
          pendingNftRewards: live
            ? toBigInt(live.pendingNftRewards)
            : (data[`${key}:pendingNftRewards`] || 0n),
          claimable: toBigInt(live?.claimableAmount),
          redeemRequests: (live?.redeemRequests || []).map(request => ({
            tokenAmount: toBigInt(request.tokenAmount),
            claimed: toBigInt(request.claimed),
            startTime: toBigInt(request.startTime),
            endTime: toBigInt(request.endTime),
          })),
          nftOwner: data[`${key}:nftOwner`] || '',
          liveError: Boolean(account && !liveResult),
        }];
      })));
    } catch (error) {
      console.error('Failed to batch load Basket child pools:', error);
      setChildrenError(true);
    } finally {
      setChildrenLoading(false);
    }
  }, [
    account,
    contracts.Multicall3,
    contracts.WETH,
    detail,
    network.id,
    pool.id,
    poolConfig.nftMiningPool,
    readProvider,
  ]);

  useEffect(() => {
    loadChildren();
    const timer = setInterval(loadChildren, 15000);
    return () => clearInterval(timer);
  }, [loadChildren]);

  useEffect(() => {
    if (!detail || !showRegister || !account || !poolConfig.nftMiningPool || !readProvider) {
      if (!account) {
        setOwnedNftIds([]);
        setNftBasketPoolCounts({});
      }
      return;
    }
    let cancelled = false;
    const loadOwnedNfts = async () => {
      try {
        const parentInterface = new ethers.Interface(BasketTVLMiningPoolABI);
        const firstPage = await fetchNftMiningNfts(
          poolConfig.nftMiningPool,
          { owner: account, page: 0, size: 100 },
          network.id,
        );
        const pageCount = Math.ceil((firstPage.total || 0) / 100);
        const remainingPages = pageCount > 1
          ? await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => (
            fetchNftMiningNfts(
              poolConfig.nftMiningPool,
              { owner: account, page: index + 1, size: 100 },
              network.id,
            )
          )))
          : [];
        const ids = [firstPage, ...remainingPages]
          .flatMap(page => page.list || [])
          .map(item => toBigInt(item.tokenId));
        const counts = ids.length > 0
          ? await multicallRead(readProvider, contracts.Multicall3, ids.map(id => ({
            key: id.toString(),
            target: pool.id,
            contractInterface: parentInterface,
            functionName: 'nftBasketPoolCount',
            args: [id],
          })))
          : {};
        if (cancelled) return;
        const nextCounts = Object.fromEntries(ids.map(id => [
          id.toString(),
          Number(counts[id.toString()] || 0),
        ]));
        setOwnedNftIds(ids);
        setNftBasketPoolCounts(nextCounts);
        setNftTokenId(current => {
          const currentOwned = ids.some(id => id.toString() === current);
          if (currentOwned && (nextCounts[current] || 0) < MAX_BASKET_POOLS_PER_NFT) return current;
          return ids.find(
            id => (nextCounts[id.toString()] || 0) < MAX_BASKET_POOLS_PER_NFT
          )?.toString() || '';
        });
      } catch (error) {
        console.error('Failed to batch load owned mining NFTs:', error);
      }
    };
    loadOwnedNfts();
    return () => {
      cancelled = true;
    };
  }, [
    account,
    contracts.Multicall3,
    detail,
    pool.id,
    poolConfig.nftMiningPool,
    network.id,
    readProvider,
    showRegister,
  ]);

  useEffect(() => {
    if (!detail) return undefined;
    const value = basketAddress.trim();
    if (!value || !ethers.isAddress(value) || !readProvider) {
      setBasketPreview(null);
      return undefined;
    }
    let cancelled = false;
    setPreviewLoading(true);
    const timer = setTimeout(async () => {
      try {
        const tokenInterface = new ethers.Interface([
          ...ERC20ABI,
          'function creatorPayout() view returns (address)',
        ]);
        const registryInterface = new ethers.Interface(['function isBasket(address) view returns (bool)']);
        const parentInterface = new ethers.Interface(BasketTVLMiningPoolABI);
        const preview = await multicallRead(readProvider, contracts.Multicall3, [
          { key: 'name', target: value, contractInterface: tokenInterface, functionName: 'name' },
          { key: 'symbol', target: value, contractInterface: tokenInterface, functionName: 'symbol' },
          { key: 'creator', target: value, contractInterface: tokenInterface, functionName: 'creatorPayout' },
          { key: 'valid', target: contracts.BasketRegistry, contractInterface: registryInterface, functionName: 'isBasket', args: [value] },
          { key: 'nav', target: pool.id, contractInterface: parentInterface, functionName: 'basketNavWeth', args: [value], allowFailure: true },
        ]);
        if (!cancelled) setBasketPreview({
          name: preview.name,
          symbol: preview.symbol,
          creator: preview.creator,
          valid: preview.valid,
          nav: preview.nav || 0n,
        });
      } catch {
        if (!cancelled) setBasketPreview({ error: true });
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    basketAddress,
    contracts.BasketRegistry,
    contracts.Multicall3,
    detail,
    pool.id,
    readProvider,
  ]);

  const execute = async (key, pendingMessage, successMessage, transaction, afterConfirmed) => {
    setActionLoading(key);
    try {
      const tx = await transaction();
      toast.info(pendingMessage);
      const receipt = await tx.wait();
      if (afterConfirmed) {
        try {
          await afterConfirmed(receipt);
        } catch (indexError) {
          console.error('Failed to index Basket child pool:', indexError);
          toast.error(t('basketPool.indexingFailed'));
        }
      }
      toast.success(successMessage);
      await Promise.all([loadParentData(), loadChildren()]);
    } catch (error) {
      toast.error(error.shortMessage || error.reason || error.message || t('basketPool.txFailed'));
    } finally {
      setActionLoading('');
    }
  };

  const handleRegister = () => execute(
    'register',
    t('basketPool.registering'),
    t('basketPool.registered'),
    () => new ethers.Contract(pool.id, BasketTVLMiningPoolABI, signer)
      .createBasketStake(basketAddress, BigInt(nftTokenId)),
    receipt => registerBasketChildPool(pool.id, receipt.hash, network.id),
  );

  const isBasketCreator = Boolean(
    account && basketPreview?.creator
      && account.toLowerCase() === basketPreview.creator.toLowerCase()
  );
  const canRegister = basketPreview?.valid && isBasketCreator && nftTokenId
    && ownedNftIds.some(id => id.toString() === nftTokenId)
    && (nftBasketPoolCounts[nftTokenId] || 0) < MAX_BASKET_POOLS_PER_NFT;
  const eligibleNftCount = ownedNftIds.filter(
    id => (nftBasketPoolCounts[id.toString()] || 0) < MAX_BASKET_POOLS_PER_NFT
  ).length;
  const selectedNftRemaining = nftTokenId
    ? Math.max(0, MAX_BASKET_POOLS_PER_NFT - (nftBasketPoolCounts[nftTokenId] || 0))
    : 0;

  return (
    <div
      className={`pool-card basket-tvl-card ${detail ? 'basket-tvl-detail' : 'basket-tvl-summary'} glass-card`}
      id={`pool-${pool.id}`}
    >
      <PoolCardHeader
        name={poolConfig.name}
        typeLabel={t('basketPool.typeName')}
        typeClassName={getPoolTypeBadgeClass(pool.poolType)}
        ratio={pool.ratio}
        status={pool.status}
      />

      <div className="basket-parent-stats">
        <div>
          <span>{t('basketPool.totalNav')}</span>
          <strong>{loading ? '…' : `${formatTokenAmount(totalNav, 18)} WETH`}</strong>
        </div>
        <div>
          <span>{t('basketPool.registeredBaskets')}</span>
          <strong>
            {childrenLoading && basketStakes.length === 0 ? '…' : childrenError ? '—' : basketCount}
          </strong>
        </div>
        <div>
          <span>{t('basketPool.nftRewardShare')}</span>
          <strong>{(poolConfig.nftRewardBps / 100).toFixed(1)}%</strong>
        </div>
        <div>
          <span>{t('basketPool.unlockPeriod')}</span>
          <strong>{formatDuration(poolConfig.lockDuration)}</strong>
        </div>
      </div>

      <div className="basket-explainer">
        <div className="basket-explainer-icon">◈</div>
        <div>
          <strong>{t('basketPool.howTitle')}</strong>
          <p>{t('basketPool.howDescription')}</p>
        </div>
      </div>

      {detail && (
        <>
          <div className="basket-parent-actions">
            {isConnected ? (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setShowRegister(value => !value)}
                disabled={Boolean(actionLoading) || pool.status !== 'OPENED'}
              >
                {showRegister ? t('basketPool.cancelRegister') : t('basketPool.registerBasket')}
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={connect} disabled={connecting}>
                {t('common.connectWallet')}
              </button>
            )}
          </div>

          {showRegister && (
            <div className="basket-register-panel">
              <div className="basket-register-copy">
                <strong>{t('basketPool.registerTitle')}</strong>
                <span>{t('basketPool.registerDescription')}</span>
              </div>
              <div className="basket-register-grid">
                <div className="input-group">
                  <label>{t('basketPool.basketAddress')}</label>
                  <input className="input" placeholder="0x..." value={basketAddress} onChange={event => setBasketAddress(event.target.value)} />
                </div>
                <div className="input-group">
                  <label>{t('basketPool.miningNft')}</label>
                  <select className="input" value={nftTokenId} onChange={event => setNftTokenId(event.target.value)}>
                    <option value="">{t('basketPool.selectNft')}</option>
                    {ownedNftIds.map(id => {
                      const tokenId = id.toString();
                      const remaining = Math.max(
                        0,
                        MAX_BASKET_POOLS_PER_NFT - (nftBasketPoolCounts[tokenId] || 0)
                      );
                      return (
                        <option key={tokenId} value={tokenId} disabled={remaining === 0}>
                          NFT #{tokenId} · {t('basketPool.nftRemainingPools', { count: remaining })}
                        </option>
                      );
                    })}
                  </select>
                  {nftTokenId && (
                    <div className="contract-field-feedback">
                      {t('basketPool.selectedNftCapacity', {
                        count: selectedNftRemaining,
                        max: MAX_BASKET_POOLS_PER_NFT,
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className={`basket-register-preview ${basketPreview?.error || basketPreview?.valid === false ? 'is-error' : ''}`}>
                {previewLoading ? (
                  <><span className="spinner" /> {t('basketPool.validatingBasket')}</>
                ) : basketPreview?.error ? (
                  t('basketPool.invalidBasket')
                ) : basketPreview ? (
                  <>
                    <div>
                      <strong>{basketPreview.name} ({basketPreview.symbol})</strong>
                      <span>{t('basketPool.currentNav')}: {formatTokenAmount(basketPreview.nav, 18)} WETH</span>
                    </div>
                    <div>
                      <span>{basketPreview.valid ? t('basketPool.verifiedBasket') : t('basketPool.unverifiedBasket')}</span>
                      <span>{isBasketCreator ? t('basketPool.creatorMatched') : t('basketPool.creatorMismatch')}</span>
                    </div>
                  </>
                ) : (
                  t('basketPool.enterBasket')
                )}
              </div>
              {ownedNftIds.length === 0 && (
                <div className="contract-field-feedback is-error">{t('basketPool.noEligibleNft')}</div>
              )}
              {ownedNftIds.length > 0 && eligibleNftCount === 0 && (
                <div className="contract-field-feedback is-error">
                  {t('basketPool.noNftCapacity', { max: MAX_BASKET_POOLS_PER_NFT })}
                </div>
              )}
              <button className="btn btn-primary" onClick={handleRegister} disabled={!canRegister || Boolean(actionLoading)}>
                {actionLoading === 'register' ? t('basketPool.registering') : t('basketPool.createChildPool')}
              </button>
            </div>
          )}

          <section className="basket-child-section">
            <div className="basket-child-section-heading">
              <div>
                <h3>{t('basketPool.childPoolsTitle')}</h3>
                <p>{t('basketPool.childPoolsDescription')}</p>
              </div>
              <span>{basketCount}</span>
            </div>
            <div className="basket-child-list">
              {childrenLoading && basketStakes.length === 0 ? (
                <div className="basket-empty">
                  <span className="spinner" /> {t('basketPool.loadingChildPools')}
                </div>
              ) : childrenError && basketStakes.length === 0 ? (
                <div className="basket-empty">
                  {t('basketPool.loadingChildPoolsFailed')}
                  <button className="btn btn-ghost btn-sm" onClick={loadChildren}>
                    {t('basketPool.retry')}
                  </button>
                </div>
              ) : basketStakes.length === 0 ? (
                <div className="basket-empty">{t('basketPool.noBaskets')}</div>
              ) : basketStakes.map(stake => (
                <div key={stake.basket} className="basket-child-wrap">
                  <BasketStakePoolCard
                    basket={stake.basket}
                    basketStake={stake}
                    parentPool={poolConfig}
                    parentStatus={pool.status}
                    communityToken={communityToken}
                    operationFee={operationFee}
                    data={childDataByBasket[stake.basket.toLowerCase()]}
                    loading={!childDataByBasket[stake.basket.toLowerCase()]}
                    onRefresh={loadChildren}
                  />
                  <button
                    className={`basket-refresh-nav is-${stake.navStatus || 'unknown'}`}
                    disabled={Boolean(actionLoading) || !signer}
                    onClick={() => execute(
                      `update-${stake.basket}`,
                      t('basketPool.updatingNav'),
                      t('basketPool.navUpdated'),
                      () => new ethers.Contract(pool.id, BasketTVLMiningPoolABI, signer)
                        .updateBasketStake(stake.basket, { value: operationFee }),
                    )}
                  >
                    {actionLoading === `update-${stake.basket}` ? (
                      <><span className="spinner" /> {t('basketPool.refreshNav')}</>
                    ) : (
                      <>↻ {t('basketPool.refreshNav')}</>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </section>

        </>
      )}

      {!detail && (
        <PoolCardFooter address={pool.id} explorerUrl={network.explorerUrl}>
          <Link className="btn btn-primary btn-sm" to={getChainPath(network.id, `community/${communityAddress}/pool/${pool.id}`)}>
            {t('basketPool.viewDetails')} →
          </Link>
        </PoolCardFooter>
      )}
    </div>
  );
}
