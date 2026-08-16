import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ethers } from 'ethers';
import {
  CommunityABI,
  ERC20ABI,
} from '../config/abis';
import { getChainPath } from '../config/contracts';
import { fetchCommunity } from '../config/subgraph';
import { useWeb3 } from '../contexts/Web3Context';
import { useToast } from '../contexts/ToastContext';
import { useLanguage } from '../contexts/LanguageContext';
import { multicallRead } from '../utils/multicall';
import { copyToClipboard, getBscScanUrl, shortenAddress } from '../utils/helpers';
import NFTMiningPoolCard from '../components/pool/NFTMiningPoolCard';
import BasketTVLMiningPoolCard from '../components/pool/BasketTVLMiningPoolCard';
import IndexBrokerNFTPoolCard from '../components/pool/IndexBrokerNFTPoolCard';
import './MiningPoolDetail.css';

export default function MiningPoolDetail() {
  const { communityAddress, poolAddress } = useParams();
  const { account, activeChainId, readProvider, contracts, network } = useWeb3();
  const toast = useToast();
  const { t } = useLanguage();
  const [pool, setPool] = useState(null);
  const [communityToken, setCommunityToken] = useState(null);
  const [communityOwner, setCommunityOwner] = useState('');
  const [loading, setLoading] = useState(true);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setCommunityToken(null);
    try {
      const community = await fetchCommunity(
        communityAddress,
        activeChainId,
        { includeHistory: false },
      );
      const indexedPool = community?.pools?.find(
        item => item.id.toLowerCase() === poolAddress.toLowerCase(),
      );
      if (!indexedPool || !['BASKET_TVL_MINING', 'NFT_MINING', 'INDEX_BROKER_NFT'].includes(indexedPool.poolType)) {
        throw new Error('Unsupported mining pool type');
      }

      setPool(indexedPool);
      setCommunityOwner(community.owner?.id || '');
      setLoading(false);

      try {
        const communityInterface = new ethers.Interface(CommunityABI);
        const tokenInterface = new ethers.Interface(ERC20ABI);
        const detail = await multicallRead(readProvider, contracts.Multicall3, [
          { key: 'active', target: communityAddress, contractInterface: communityInterface, functionName: 'poolActived', args: [poolAddress] },
          { key: 'ratio', target: communityAddress, contractInterface: communityInterface, functionName: 'poolRatios', args: [poolAddress] },
          { key: 'name', target: community.cToken, contractInterface: tokenInterface, functionName: 'name' },
          { key: 'symbol', target: community.cToken, contractInterface: tokenInterface, functionName: 'symbol' },
          { key: 'decimals', target: community.cToken, contractInterface: tokenInterface, functionName: 'decimals' },
        ]);

        setPool(current => current ? ({
          ...current,
          ratio: Number(detail.ratio || 0),
          status: detail.active ? 'OPENED' : 'CLOSED',
        }) : current);
        setCommunityToken({
          address: community.cToken,
          name: detail.name,
          symbol: detail.symbol,
          decimals: Number(detail.decimals),
        });
      } catch (error) {
        console.error('Failed to refresh mining pool chain state:', error);
      }
    } catch (error) {
      console.error('Failed to load mining pool detail:', error);
      setPool(null);
      setLoading(false);
    }
  }, [
    activeChainId,
    communityAddress,
    contracts.Multicall3,
    poolAddress,
    readProvider,
  ]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const isOwner = Boolean(
    account && communityOwner && account.toLowerCase() === communityOwner.toLowerCase()
  );
  const isBasketPool = pool?.poolType === 'BASKET_TVL_MINING';
  const isIndexBrokerPool = pool?.poolType === 'INDEX_BROKER_NFT';
  const isSupportedPool = isBasketPool || isIndexBrokerPool || pool?.poolType === 'NFT_MINING';
  const displayedPoolAddress = pool?.id || poolAddress;

  const handleCopyPoolAddress = async () => {
    if (await copyToClipboard(displayedPoolAddress)) {
      toast.info(t('common.copySuccess'));
    }
  };

  return (
    <div className={`page container ${isBasketPool ? 'basket-pool-detail-page' : 'nft-pool-detail-page'}`}>
      <div className="mining-pool-detail-topbar">
        <nav className="breadcrumb">
          <Link to={getChainPath(activeChainId)}>{t('detail.breadcrumbHome')}</Link>
          <span className="breadcrumb-sep">/</span>
          <Link to={getChainPath(activeChainId, `community/${communityAddress}`)}>{t('detail.backToCommunity')}</Link>
          <span className="breadcrumb-sep">/</span>
          <span>{pool?.name || t('detail.poolDetailTitle')}</span>
        </nav>
        <div className="mining-pool-contract-address">
          <a
            href={getBscScanUrl(displayedPoolAddress, 'address', network.explorerUrl)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {shortenAddress(displayedPoolAddress)} ↗
          </a>
          <button
            type="button"
            className="mining-pool-copy-address"
            onClick={handleCopyPoolAddress}
            title={t('common.copyAddress')}
            aria-label={t('common.copyAddress')}
          >
            ⧉
          </button>
        </div>
      </div>

      {loading ? (
        <div className="glass-card nft-detail-state">{t('detail.poolDetailLoading')}</div>
      ) : !pool || !isSupportedPool ? (
        <div className="glass-card nft-detail-state">
          <p>{t('detail.poolDetailNotFound')}</p>
          <Link className="btn btn-secondary" to={getChainPath(activeChainId, `community/${communityAddress}`)}>
            {t('detail.backToCommunity')}
          </Link>
        </div>
      ) : isBasketPool ? (
        <BasketTVLMiningPoolCard
          pool={pool}
          communityAddress={communityAddress}
          communityToken={communityToken}
          onRefresh={loadDetail}
          detail
        />
      ) : isIndexBrokerPool ? (
        <IndexBrokerNFTPoolCard
          pool={pool}
          communityAddress={communityAddress}
          communityToken={communityToken}
          isOwner={isOwner}
          onRefresh={loadDetail}
          detail
        />
      ) : (
        <NFTMiningPoolCard
          pool={pool}
          communityAddress={communityAddress}
          communityToken={communityToken}
          isOwner={isOwner}
          onRefresh={loadDetail}
          detail
        />
      )}
    </div>
  );
}
