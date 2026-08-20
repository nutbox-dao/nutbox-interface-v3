import { useCallback, useEffect, useRef, useState } from 'react';
import { ethers } from 'ethers';
import { Link } from 'react-router-dom';
import { useWeb3 } from '../../contexts/Web3Context';
import { useToast } from '../../contexts/ToastContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { CommunityABI, ERC20ABI, NFTMiningPoolABI } from '../../config/abis';
import { getChainPath } from '../../config/contracts';
import useTimedActionLoading from '../../hooks/useTimedActionLoading';
import {
  fetchNftMiningAccounts,
  fetchNftMiningEvents,
  fetchNftMiningNfts,
  fetchNftMiningPool,
} from '../../config/subgraph';
import {
  copyToClipboard,
  formatDate,
  formatTokenAmount,
  getPoolTypeBadgeClass,
  shortenAddress,
} from '../../utils/helpers';
import { PoolCardFooter, PoolCardHeader } from './PoolCardTemplate';
import './NFTMiningPoolCard.css';

const EMPTY_BATCH = {
  paymentAsset: ethers.ZeroAddress,
  referralBps: 0,
  paletteId: 0,
  active: false,
  paused: false,
  mintPrice: 0n,
  maxSupply: 0n,
  minted: 0n,
};

const NFT_EVENT_LABELS = {
  NFT_MINTED: 'nftPool.eventMinted',
  NFT_LEVEL_UP: 'nftPool.eventLevelUp',
  NFT_REFERRAL_RECORDED: 'nftPool.eventReferralRecorded',
  NFT_PLATFORM_FEE_PAID: 'nftPool.eventPlatformFeePaid',
  NFT_MINING_WEIGHT_MOVED: 'nftPool.eventMiningWeightMoved',
  NFT_TRANSFERRED: 'nftPool.eventTransferred',
};

function svgDataUrl(svg) {
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : '';
}

function toBigInt(value, fallback = 0n) {
  try {
    return value === null || value === undefined || value === '' ? fallback : BigInt(value);
  } catch {
    return fallback;
  }
}

function normalizeNftLevel(value) {
  const level = Number(value);
  return Number.isFinite(level) && level > 0 ? level : 1;
}

export default function NFTMiningPoolCard({
  pool,
  communityAddress,
  communityToken,
  isOwner,
  onRefresh,
  detail = false,
}) {
  const { account, getWriteSigner, readProvider, isConnected, connecting, connect, contracts, network } = useWeb3();
  const { t } = useLanguage();
  const toast = useToast();

  const [collection, setCollection] = useState({ name: pool.name || t('nftPool.fallbackName'), symbol: 'NFT' });
  const [currentBatchId, setCurrentBatchId] = useState(0n);
  const [batch, setBatch] = useState(EMPTY_BATCH);
  const [totalSupply, setTotalSupply] = useState(0n);
  const [totalWeight, setTotalWeight] = useState(0n);
  const [upgradeLevels, setUpgradeLevels] = useState([]);
  const [userWeight, setUserWeight] = useState(0n);
  const [pendingRewards, setPendingRewards] = useState(0n);
  const [ownedNFTCount, setOwnedNFTCount] = useState(0n);
  const [ownedNFTs, setOwnedNFTs] = useState([]);
  const [ownedNFTAccount, setOwnedNFTAccount] = useState('');
  const [paymentInfo, setPaymentInfo] = useState({ symbol: network.nativeCurrency.symbol, decimals: 18 });
  const [allowance, setAllowance] = useState(0n);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useTimedActionLoading('');
  const [referrerTokenId, setReferrerTokenId] = useState('');
  const [showReferralPicker, setShowReferralPicker] = useState(false);
  const [showReferralGuide, setShowReferralGuide] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [newBatch, setNewBatch] = useState({ supply: '', paymentAsset: '', price: '', referralPercent: '10' });
  const [newReceiver, setNewReceiver] = useState('');
  const [topAccounts, setTopAccounts] = useState([]);
  const [recentEvents, setRecentEvents] = useState([]);
  const [insightsLoading, setInsightsLoading] = useState(detail);
  const loadRequestRef = useRef(0);
  const ownedNftImagesRef = useRef(new Map());

  const isNativePayment = batch.paymentAsset === ethers.ZeroAddress;

  const loadPoolData = useCallback(async () => {
    if (!readProvider) return;
    const requestId = ++loadRequestRef.current;
    try {
      const indexedPool = await fetchNftMiningPool(pool.id, network.id);
      if (!indexedPool) throw new Error('NFT mining pool is not indexed');
      const poolContract = new ethers.Contract(pool.id, NFTMiningPoolABI, readProvider);
      const communityContract = new ethers.Contract(communityAddress, CommunityABI, readProvider);
      const nextBatchId = toBigInt(indexedPool.currentBatchId);
      const rawBatch = (indexedPool.batches || []).find(
        item => toBigInt(item.batchId) === nextBatchId,
      );
      const nextBatch = rawBatch ? {
        paymentAsset: rawBatch.paymentAsset,
        referralBps: Number(rawBatch.referralBps),
        paletteId: Number(rawBatch.paletteId),
        active: Boolean(Number(rawBatch.active)),
        paused: Boolean(Number(rawBatch.paused)),
        mintPrice: toBigInt(rawBatch.mintPrice),
        maxSupply: toBigInt(rawBatch.maxSupply),
        minted: toBigInt(rawBatch.minted),
      } : EMPTY_BATCH;

      if (requestId !== loadRequestRef.current) return;
      setCollection({
        name: indexedPool.name || pool.name || t('nftPool.fallbackName'),
        symbol: indexedPool.symbol || 'NFT',
      });
      setCurrentBatchId(nextBatchId);
      setBatch(nextBatch);
      setTotalSupply(toBigInt(indexedPool.totalSupply));
      setTotalWeight(toBigInt(indexedPool.totalMiningWeight));
      setLoading(false);

      if (detail) {
        const levelCount = await poolContract.levelCount().catch(() => 0n);
        const levelIndexes = Array.from({ length: Number(levelCount) }, (_, index) => index);
        const levels = await Promise.all(levelIndexes.map(async index => {
          const [threshold, weight] = await Promise.all([
            poolContract.levelThresholds(index),
            poolContract.levelWeights(index),
          ]);
          return { level: index + 1, threshold, weight };
        }));
        if (requestId === loadRequestRef.current) setUpgradeLevels(levels);
      }

      let nextPaymentInfo = { symbol: network.nativeCurrency.symbol, decimals: 18 };
      if (nextBatch.paymentAsset !== ethers.ZeroAddress) {
        const paymentToken = new ethers.Contract(nextBatch.paymentAsset, ERC20ABI, readProvider);
        const [paymentSymbol, paymentDecimals] = await Promise.all([
          paymentToken.symbol().catch(() => 'ERC20'),
          paymentToken.decimals().catch(() => 18),
        ]);
        nextPaymentInfo = { symbol: paymentSymbol, decimals: Number(paymentDecimals) };
      }
      if (requestId === loadRequestRef.current) setPaymentInfo(nextPaymentInfo);

      if (account) {
        const [weightOfUser, pending, ownedBalance] = await Promise.all([
          poolContract.getUserStakedAmount(account),
          communityContract.getPoolPendingRewards(pool.id, account).catch(() => 0n),
          poolContract.balanceOf(account),
        ]);
        if (requestId !== loadRequestRef.current) return;
        setUserWeight(weightOfUser);
        setPendingRewards(pending);
        setOwnedNFTCount(ownedBalance);

        if (detail) {
          const firstPage = await fetchNftMiningNfts(
            pool.id,
            { owner: account, page: 0, size: 100 },
            network.id,
          );
          const pages = [firstPage];
          const totalPages = Math.ceil((firstPage.total || 0) / 100);
          if (totalPages > 1) {
            const remaining = await Promise.all(
              Array.from({ length: totalPages - 1 }, (_, index) => (
                fetchNftMiningNfts(
                  pool.id,
                  { owner: account, page: index + 1, size: 100 },
                  network.id,
                )
              )),
            );
            pages.push(...remaining);
          }
          const nftItems = pages.flatMap(page => page.list || []).map(item => ({
            tokenId: toBigInt(item.tokenId),
            level: normalizeNftLevel(item.level),
            referralCount: toBigInt(item.referralCount),
            miningWeight: toBigInt(item.miningWeight),
            image: ownedNftImagesRef.current.get(String(item.tokenId)) || '',
          }));
          if (requestId !== loadRequestRef.current) return;
          setOwnedNFTs(nftItems);
          setOwnedNFTAccount(account.toLowerCase());

          Promise.all(nftItems.map(async item => ({
            tokenId: item.tokenId,
            image: svgDataUrl(await poolContract.tokenSVG(item.tokenId).catch(() => '')),
          }))).then(images => {
            if (requestId !== loadRequestRef.current) return;
            images.forEach(item => {
              if (item.image) {
                ownedNftImagesRef.current.set(item.tokenId.toString(), item.image);
              }
            });
            setOwnedNFTs(current => current.map(item => ({
              ...item,
              image: ownedNftImagesRef.current.get(item.tokenId.toString()) || item.image,
            })));
          });
        } else {
          setOwnedNFTs([]);
          setOwnedNFTAccount(account.toLowerCase());
        }

        if (nextBatch.paymentAsset !== ethers.ZeroAddress) {
          const paymentToken = new ethers.Contract(nextBatch.paymentAsset, ERC20ABI, readProvider);
          setAllowance(await paymentToken.allowance(account, pool.id).catch(() => 0n));
        } else {
          setAllowance(0n);
        }
      } else {
        setUserWeight(0n);
        setPendingRewards(0n);
        setOwnedNFTCount(0n);
        setOwnedNFTs([]);
        setOwnedNFTAccount('');
        setAllowance(0n);
      }
    } catch (error) {
      console.error('Failed to load NFT mining pool:', error);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [
    account,
    communityAddress,
    detail,
    network.id,
    network.nativeCurrency.symbol,
    pool.id,
    pool.name,
    readProvider,
    t,
  ]);

  useEffect(() => {
    loadPoolData();
    const timer = setInterval(loadPoolData, 15000);
    return () => clearInterval(timer);
  }, [loadPoolData]);

  useEffect(() => {
    if (!detail) return undefined;
    let cancelled = false;
    setInsightsLoading(true);
    Promise.all([
      fetchNftMiningAccounts(pool.id, { page: 0, size: 10 }, network.id),
      fetchNftMiningEvents(pool.id, { page: 0, size: 10 }, network.id),
    ]).then(([accountsData, eventsData]) => {
      if (cancelled) return;
      setTopAccounts(accountsData.list || []);
      setRecentEvents(eventsData.list || []);
    }).catch(error => {
      console.error('Failed to load NFT mining insights:', error);
    }).finally(() => {
      if (!cancelled) setInsightsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [detail, network.id, pool.id]);

  useEffect(() => {
    if (!detail) return;
    const value = new URLSearchParams(window.location.search).get('referrerTokenId');
    if (value && /^\d+$/.test(value) && BigInt(value) > 0n) {
      setReferrerTokenId(value);
    }
  }, [detail, pool.id]);

  const waitForAction = async (key, pendingMessage, successMessage, action) => {
    setActionLoading(key);
    try {
      const writeSigner = await getWriteSigner();
      const tx = await action(writeSigner);
      toast.info(pendingMessage);
      await tx.wait();
      toast.success(successMessage);
      await loadPoolData();
      onRefresh?.();
    } catch (error) {
      toast.error(error.shortMessage || error.reason || error.message || t('nftPool.txFailed'));
    } finally {
      setActionLoading('');
    }
  };

  const handleApprove = () => waitForAction(
    'approve',
    t('nftPool.toastApproving'),
    t('nftPool.toastApproved'),
    writeSigner => new ethers.Contract(batch.paymentAsset, ERC20ABI, writeSigner).approve(pool.id, ethers.MaxUint256),
  );

  const handleMint = () => {
    return waitForAction(
      'mint',
      t('nftPool.toastMinting'),
      t('nftPool.toastMinted'),
      writeSigner => {
        const referrer = referrerTokenId.trim() ? BigInt(referrerTokenId) : 0n;
        return new ethers.Contract(pool.id, NFTMiningPoolABI, writeSigner).mint(
          referrer,
          isNativePayment ? { value: batch.mintPrice } : {},
        );
      },
    );
  };

  const handleClaim = () => waitForAction(
    'claim',
    t('nftPool.toastClaiming'),
    t('nftPool.toastClaimed'),
    async writeSigner => {
      const committee = new ethers.Contract(
        contracts.Committee,
        ['function getPoolOperationFee() view returns (uint256)'],
        readProvider,
      );
      const fee = await committee.getPoolOperationFee();
      return new ethers.Contract(communityAddress, CommunityABI, writeSigner)
        .withdrawPoolsRewards([pool.id], { value: fee });
    },
  );

  const handlePause = () => waitForAction(
    'pause',
    t('nftPool.toastUpdatingBatch'),
    t('nftPool.toastBatchUpdated'),
    writeSigner => new ethers.Contract(pool.id, NFTMiningPoolABI, writeSigner).setCurrentBatchPaused(!batch.paused),
  );

  const handleCloseBatch = () => waitForAction(
    'close',
    t('nftPool.toastClosingBatch'),
    t('nftPool.toastBatchClosed'),
    writeSigner => new ethers.Contract(pool.id, NFTMiningPoolABI, writeSigner).closeCurrentBatch(),
  );

  const handleCreateBatch = () => waitForAction(
    'new-batch',
    t('nftPool.toastCreatingBatch'),
    t('nftPool.toastBatchCreated'),
    async writeSigner => {
      const paymentAsset = newBatch.paymentAsset.trim() || ethers.ZeroAddress;
      if (paymentAsset !== ethers.ZeroAddress && !ethers.isAddress(paymentAsset)) {
        throw new Error(t('nftPool.invalidPaymentToken'));
      }
      let decimals = 18;
      if (paymentAsset !== ethers.ZeroAddress) {
        decimals = Number(await new ethers.Contract(paymentAsset, ERC20ABI, readProvider).decimals());
      }
      const price = ethers.parseUnits(newBatch.price, decimals);
      const referralBps = Math.round(Number(newBatch.referralPercent) * 100);
      if (!newBatch.supply || BigInt(newBatch.supply) <= 0n || price <= 0n || referralBps < 0 || referralBps > 10000) {
        throw new Error(t('nftPool.invalidBatchConfig'));
      }
      return new ethers.Contract(pool.id, NFTMiningPoolABI, writeSigner)
        .createBatch(BigInt(newBatch.supply), paymentAsset, price, referralBps);
    },
  );

  const handleSetReceiver = () => waitForAction(
    'receiver',
    t('nftPool.toastUpdatingReceiver'),
    t('nftPool.toastReceiverUpdated'),
    writeSigner => {
      if (!ethers.isAddress(newReceiver)) throw new Error(t('nftPool.invalidReceiver'));
      return new ethers.Contract(pool.id, NFTMiningPoolABI, writeSigner).setFundsReceiver(newReceiver);
    },
  );

  const needsApproval = !isNativePayment && allowance < batch.mintPrice;
  const canMint = batch.active && !batch.paused && batch.minted < batch.maxSupply;
  const busy = Boolean(actionLoading);
  const walletDataReady = Boolean(account && ownedNFTAccount === account.toLowerCase());
  const referralReady = walletDataReady && ownedNFTs.length > 0;

  const copyReferralLink = async (tokenId) => {
    const detailPath = getChainPath(
      network.id,
      `community/${communityAddress}/pool/${pool.id}`,
    );
    const url = new URL(detailPath, window.location.origin);
    if (tokenId) {
      url.searchParams.set('referrerTokenId', tokenId.toString());
    } else {
      url.searchParams.delete('referrerTokenId');
    }

    const copied = await copyToClipboard(url.toString());
    if (copied) {
      toast.success(t('nftPool.referralLinkCopied'));
      setShowReferralPicker(false);
    } else {
      toast.error(t('nftPool.referralLinkCopyFailed'));
    }
  };

  const handleShareReferral = () => {
    if (!referralReady) return;
    if (ownedNFTs.length > 1) {
      setShowReferralPicker(true);
      return;
    }
    copyReferralLink(ownedNFTs[0]?.tokenId);
  };

  return (
    <>
      <div className={`pool-card nft-mining-card ${detail ? 'nft-mining-detail' : 'nft-mining-summary'} glass-card`} id={`pool-${pool.id}`}>
      <PoolCardHeader
        name={collection.name}
        subtitle={detail ? collection.symbol : ''}
        typeLabel={t('nftPool.typeName')}
        typeClassName={getPoolTypeBadgeClass(pool.poolType)}
        ratio={pool.ratio}
        status={pool.status}
      />

      <div className="nft-batch-banner">
        <div>
          <span>{t('nftPool.currentBatch')}</span>
          <strong>#{currentBatchId > 0n ? currentBatchId.toString() : '—'} · P{batch.paletteId || '—'}</strong>
        </div>
        <div>
          <span>{t('nftPool.mintProgress')}</span>
          <strong>{batch.minted.toString()} / {batch.maxSupply.toString()}</strong>
        </div>
        <div>
          <span>{t('nftPool.mintPrice')}</span>
          <strong>{formatTokenAmount(batch.mintPrice, paymentInfo.decimals)} {paymentInfo.symbol}</strong>
        </div>
        <div>
          <span>{t('nftPool.referralCommission')}</span>
          <strong>{(batch.referralBps / 100).toFixed(2)}%</strong>
        </div>
      </div>

      <div className="pool-stats-grid">
        <div className="pool-stat">
          <div className="pool-stat-label">{t('nftPool.nftSupply')}</div>
          <div className="pool-stat-value">{loading ? '—' : totalSupply.toString()}</div>
        </div>
        <div className="pool-stat">
          <div className="pool-stat-label">{t('nftPool.totalWeight')}</div>
          <div className="pool-stat-value">{loading ? '—' : totalWeight.toString()}</div>
        </div>
        <div className="pool-stat">
          <div className="pool-stat-label">{t('nftPool.batchStatus')}</div>
          <div className="pool-stat-value">
            {!batch.active ? t('nftPool.batchClosed') : batch.paused ? t('nftPool.batchPaused') : t('nftPool.batchMinting')}
          </div>
        </div>
        {detail && (
          <div className="pool-stat nft-referral-toggle-stat">
            <button
              className={`btn btn-sm nft-referral-toggle ${showReferralGuide ? 'is-open' : ''}`}
              type="button"
              aria-expanded={showReferralGuide}
              onClick={() => setShowReferralGuide(value => !value)}
            >
              {showReferralGuide ? t('nftPool.collapseReferralGuide') : t('nftPool.referralIncentives')}
            </button>
          </div>
        )}
      </div>

      {detail && showReferralGuide && (
        <section className="nft-referral-guide">
          <div className="nft-referral-guide-copy">
            <span className="nft-referral-guide-kicker">{t('nftPool.referralGuideKicker')}</span>
            <h3>{t('nftPool.referralGuideTitle')}</h3>
            <p>{t('nftPool.referralGuideDescription')}</p>
            <ul>
              <li>{t('nftPool.referralGuideLink')}</li>
              <li>{t('nftPool.referralGuideCommission', { rate: (batch.referralBps / 100).toFixed(2) })}</li>
              <li>{t('nftPool.referralGuideUpgrade')}</li>
            </ul>
            {isConnected && (
              <div className="nft-referral-guide-actions">
                <button className="btn btn-primary btn-sm" disabled={!referralReady} onClick={handleShareReferral}>
                  {!referralReady ? <span className="spinner" /> : null}
                  {t('nftPool.shareReferral')}
                </button>
              </div>
            )}
          </div>
          <div className="nft-upgrade-panel">
            <div className="nft-upgrade-heading">
              <strong>{t('nftPool.upgradePathTitle')}</strong>
              <span>{t('nftPool.upgradePathCurrent')}</span>
            </div>
            <div className="nft-upgrade-levels">
              {upgradeLevels.map(item => (
                <div className="nft-upgrade-level" key={item.level}>
                  <span>Lv.{item.level}</span>
                  <strong>
                    {item.level === 1
                      ? t('nftPool.upgradeInitial')
                      : t('nftPool.upgradeRequirement', { count: item.threshold.toString() })}
                  </strong>
                  <small>{t('nftPool.upgradeWeight', { weight: item.weight.toString() })}</small>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {!detail && (
        <>
          {isConnected && (
            <div className="nft-summary-user">
              <div className="nft-summary-user-stats">
                <div>
                  <span>{t('nftPool.ownedNFTCount')}</span>
                  <strong>{!walletDataReady ? '—' : ownedNFTCount.toString()}</strong>
                </div>
                <div>
                  <span>{t('nftPool.myWeight')}</span>
                  <strong>{!walletDataReady ? '—' : userWeight.toString()}</strong>
                </div>
                <div>
                  <span>{t('nftPool.pendingRewards')}</span>
                  <strong className="pool-rewards-value">
                    {!walletDataReady ? '—' : `${formatTokenAmount(pendingRewards, communityToken?.decimals || 18)} ${communityToken?.symbol || ''}`}
                  </strong>
                </div>
              </div>
              <button
                className="btn btn-success btn-sm"
                disabled={busy || !walletDataReady || pendingRewards <= 0n}
                onClick={handleClaim}
              >
                {actionLoading === 'claim' ? <span className="spinner" /> : null}
                {t('nftPool.claimRewards')}
              </button>
            </div>
          )}

        </>
      )}

      {detail && isConnected && (
        <div className="pool-user-section">
          <div className="pool-user-stats">
            <div className="pool-user-stat">
              <span className="pool-user-label">{t('nftPool.myWeight')}</span>
              <span className="pool-user-value">{userWeight.toString()}</span>
            </div>
            <div className="pool-user-stat">
              <span className="pool-user-label">{t('nftPool.pendingRewards')}</span>
              <span className="pool-user-value pool-rewards-value">
                {formatTokenAmount(pendingRewards, communityToken?.decimals || 18)} {communityToken?.symbol || ''}
              </span>
            </div>
          </div>

          {canMint && (
            <div className="nft-mint-panel">
              <div className="input-group nft-referrer-field">
                <label>{t('nftPool.referrerTokenId')}</label>
                <input
                  type="number"
                  className="input"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={referrerTokenId}
                  onChange={event => setReferrerTokenId(event.target.value)}
                />
              </div>
              {needsApproval ? (
                <button className="btn btn-primary nft-mint-action" disabled={busy} onClick={handleApprove}>
                  {actionLoading === 'approve' ? <span className="spinner" /> : null}
                  {t('nftPool.approve', { symbol: paymentInfo.symbol })}
                </button>
              ) : (
                <button className="btn btn-primary nft-mint-action" disabled={busy} onClick={handleMint}>
                  {actionLoading === 'mint' ? <span className="spinner" /> : null}
                  {t('nftPool.mintAction')}
                </button>
              )}
            </div>
          )}

          <div className="pool-actions">
            {pendingRewards > 0n && (
              <button className="btn btn-success btn-sm" disabled={busy} onClick={handleClaim}>
                {t('nftPool.claimRewards')}
              </button>
            )}
            {isOwner && (
              <button className="btn btn-secondary btn-sm" onClick={() => setShowAdmin(value => !value)}>
                {t('nftPool.manageBatch')}
              </button>
            )}
          </div>

          {isOwner && showAdmin && (
            <div className="nft-admin-panel">
              <div className="nft-admin-actions">
                {batch.active && (
                  <>
                    <button className="btn btn-secondary btn-sm" disabled={busy} onClick={handlePause}>
                      {batch.paused ? t('nftPool.resumeMinting') : t('nftPool.pauseMinting')}
                    </button>
                    <button className="btn btn-danger btn-sm" disabled={busy} onClick={handleCloseBatch}>
                      {t('nftPool.closeCurrentBatch')}
                    </button>
                  </>
                )}
              </div>

              {!batch.active && (
                <div className="nft-admin-form">
                  <strong>{t('nftPool.createNextBatch')}</strong>
                  <div className="nft-admin-grid">
                    <input className="input" type="number" min="1" step="1" placeholder={t('nftPool.supplyPlaceholder')} value={newBatch.supply} onChange={event => setNewBatch(value => ({ ...value, supply: event.target.value }))} />
                    <input className="input" placeholder={t('nftPool.paymentPlaceholder')} value={newBatch.paymentAsset} onChange={event => setNewBatch(value => ({ ...value, paymentAsset: event.target.value }))} />
                    <input className="input" type="number" min="0" step="any" placeholder={t('nftPool.pricePlaceholder')} value={newBatch.price} onChange={event => setNewBatch(value => ({ ...value, price: event.target.value }))} />
                    <input className="input" type="number" min="0" max="100" step="0.1" placeholder={t('nftPool.referralPlaceholder')} value={newBatch.referralPercent} onChange={event => setNewBatch(value => ({ ...value, referralPercent: event.target.value }))} />
                  </div>
                  <button className="btn btn-primary btn-sm" disabled={busy || !newBatch.supply || !newBatch.price} onClick={handleCreateBatch}>
                    {t('nftPool.createBatch')}
                  </button>
                </div>
              )}

              <div className="nft-receiver-form">
                <input className="input" placeholder={t('nftPool.receiverPlaceholder')} value={newReceiver} onChange={event => setNewReceiver(event.target.value)} />
                <button className="btn btn-secondary btn-sm" disabled={busy || !newReceiver} onClick={handleSetReceiver}>
                  {t('nftPool.updateReceiver')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!detail && (
        <PoolCardFooter address={pool.id} explorerUrl={network.explorerUrl}>
          <Link className="btn btn-primary btn-sm" to={getChainPath(network.id, `community/${communityAddress}/pool/${pool.id}`)}>
            {t('nftPool.viewDetails')} →
          </Link>
        </PoolCardFooter>
      )}
      </div>

      {detail && (
        <section className="nft-owned-collection glass-card">
          <div className="owned-nft-heading">
            <div>
              <h2>{t('nftPool.myNFTs')}</h2>
              <p>{t('nftPool.myNFTsDescription')}</p>
            </div>
            {isConnected && ownedNFTs.length > 0 && (
              <span>{t('nftPool.ownedCount', { count: ownedNFTs.length })}</span>
            )}
          </div>

          {!isConnected ? (
            <div className="nft-owned-empty">
              <strong>{t('nftPool.connectNFTTitle')}</strong>
              <span>{t('nftPool.connectNFTDescription')}</span>
              <button className="btn btn-primary" type="button" disabled={connecting} onClick={connect}>
                {connecting ? t('header.connecting') : t('header.connect')}
              </button>
            </div>
          ) : ownedNFTAccount !== account?.toLowerCase() ? (
            <div className="nft-owned-empty">
              <span className="spinner" />
              <span>{t('nftPool.loadingNFTs')}</span>
            </div>
          ) : ownedNFTs.length === 0 ? (
            <div className="nft-owned-empty">
              <strong>{t('nftPool.noNFTsTitle')}</strong>
              <span>{t('nftPool.noNFTsDescription')}</span>
            </div>
          ) : (
            <div className="owned-nft-grid">
              {ownedNFTs.map(nft => (
                <article className="owned-nft-item" key={nft.tokenId.toString()}>
                  {nft.image ? <img src={nft.image} alt={`${collection.name} #${nft.tokenId}`} /> : <div className="owned-nft-placeholder">NFT</div>}
                  <div>
                    <strong>#{nft.tokenId.toString()} · Lv.{nft.level}</strong>
                    <span>{t('nftPool.weight')} {nft.miningWeight.toString()} · {t('nftPool.refs')} {nft.referralCount.toString()}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {detail && (
        <section className="nft-mining-insights">
          <div className="nft-insight-panel glass-card">
            <div className="nft-insight-heading">
              <div>
                <h2>{t('nftPool.holderRanking')}</h2>
                <p>{t('nftPool.holderRankingDescription')}</p>
              </div>
            </div>
            {insightsLoading ? (
              <div className="nft-insight-empty"><span className="spinner" /></div>
            ) : topAccounts.length === 0 ? (
              <div className="nft-insight-empty">{t('nftPool.noRankingData')}</div>
            ) : (
              <div className="nft-ranking-list">
                {topAccounts.map((item, index) => (
                  <div className="nft-ranking-row" key={item.account}>
                    <span>#{index + 1}</span>
                    <a href={`${network.explorerUrl}/address/${item.account}`} target="_blank" rel="noopener noreferrer">
                      {shortenAddress(item.account)}
                    </a>
                    <strong>{item.miningWeight}</strong>
                    <small>{t('nftPool.rankingNftCount', { count: item.nftCount })}</small>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="nft-insight-panel glass-card">
            <div className="nft-insight-heading">
              <div>
                <h2>{t('nftPool.recentActivity')}</h2>
                <p>{t('nftPool.recentActivityDescription')}</p>
              </div>
            </div>
            {insightsLoading ? (
              <div className="nft-insight-empty"><span className="spinner" /></div>
            ) : recentEvents.length === 0 ? (
              <div className="nft-insight-empty">{t('nftPool.noActivityData')}</div>
            ) : (
              <div className="nft-event-list">
                {recentEvents.map(event => {
                  const txHash = event.transactionHash?.startsWith('0x')
                    ? event.transactionHash
                    : `0x${event.transactionHash}`;
                  return (
                    <a
                      className="nft-event-row"
                      href={`${network.explorerUrl}/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      key={event.id}
                    >
                      <div>
                        <strong>{t(NFT_EVENT_LABELS[event.eventType] || 'nftPool.eventOther')}</strong>
                        <span>
                          {event.tokenId ? `NFT #${event.tokenId}` : shortenAddress(event.account)}
                        </span>
                      </div>
                      <small>{formatDate(event.blockTimestamp)}</small>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {detail && showReferralPicker && (
        <div className="modal-overlay" onClick={() => setShowReferralPicker(false)}>
          <div className="modal-content nft-referral-modal" onClick={event => event.stopPropagation()}>
            <div className="nft-referral-modal-header">
              <div>
                <h2>{t('nftPool.selectReferralNFT')}</h2>
                <p>{t('nftPool.selectReferralNFTDescription')}</p>
              </div>
              <button className="modal-close" type="button" aria-label={t('common.cancel')} onClick={() => setShowReferralPicker(false)}>×</button>
            </div>
            <div className="nft-referral-list">
              {ownedNFTs.map(nft => (
                <button
                  className="owned-nft-item nft-referral-option"
                  type="button"
                  key={nft.tokenId.toString()}
                  onClick={() => copyReferralLink(nft.tokenId)}
                >
                  {nft.image ? <img src={nft.image} alt={`${collection.name} #${nft.tokenId}`} /> : <div className="owned-nft-placeholder">NFT</div>}
                  <div>
                    <strong>#{nft.tokenId.toString()} · Lv.{nft.level}</strong>
                    <span>{t('nftPool.weight')} {nft.miningWeight.toString()} · {t('nftPool.refs')} {nft.referralCount.toString()}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
