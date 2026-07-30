import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ethers } from 'ethers';
import {
  BasketTVLMiningPoolABI,
  CommitteeABI,
  CommunityABI,
  ERC20ABI,
} from '../config/abis';
import { getChainPath } from '../config/contracts';
import { useWeb3 } from '../contexts/Web3Context';
import { useToast } from '../contexts/ToastContext';
import { useLanguage } from '../contexts/LanguageContext';
import { multicallRead } from '../utils/multicall';
import { copyToClipboard, getBscScanUrl, shortenAddress } from '../utils/helpers';
import NFTMiningPoolCard from '../components/pool/NFTMiningPoolCard';
import BasketTVLMiningPoolCard from '../components/pool/BasketTVLMiningPoolCard';
import './MiningPoolDetail.css';

export default function MiningPoolDetail() {
  const { communityAddress, poolAddress } = useParams();
  const { account, activeChainId, readProvider, contracts, network } = useWeb3();
  const toast = useToast();
  const { t } = useLanguage();
  const [pool, setPool] = useState(null);
  const [communityToken, setCommunityToken] = useState(null);
  const [communityOwner, setCommunityOwner] = useState('');
  const [basketInitialData, setBasketInitialData] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setCommunityToken(null);
    setBasketInitialData(null);
    try {
      const poolInterface = new ethers.Interface(BasketTVLMiningPoolABI);
      const communityInterface = new ethers.Interface(CommunityABI);
      const committeeInterface = new ethers.Interface(CommitteeABI);
      const detail = await multicallRead(readProvider, contracts.Multicall3, [
        { key: 'name', target: poolAddress, contractInterface: poolInterface, functionName: 'name' },
        { key: 'factory', target: poolAddress, contractInterface: poolInterface, functionName: 'factory' },
        { key: 'poolCommunity', target: poolAddress, contractInterface: poolInterface, functionName: 'community' },
        { key: 'nftMiningPool', target: poolAddress, contractInterface: poolInterface, functionName: 'nftMiningPool', allowFailure: true },
        { key: 'lockDuration', target: poolAddress, contractInterface: poolInterface, functionName: 'lockDuration', allowFailure: true },
        { key: 'nftRewardBps', target: poolAddress, contractInterface: poolInterface, functionName: 'nftRewardBps', allowFailure: true },
        { key: 'totalNav', target: poolAddress, contractInterface: poolInterface, functionName: 'getTotalStakedAmount', allowFailure: true },
        { key: 'owner', target: communityAddress, contractInterface: communityInterface, functionName: 'owner' },
        { key: 'communityToken', target: communityAddress, contractInterface: communityInterface, functionName: 'communityToken' },
        { key: 'active', target: communityAddress, contractInterface: communityInterface, functionName: 'poolActived', args: [poolAddress] },
        { key: 'ratio', target: communityAddress, contractInterface: communityInterface, functionName: 'poolRatios', args: [poolAddress] },
        { key: 'operationFee', target: contracts.Committee, contractInterface: committeeInterface, functionName: 'getPoolOperationFee' },
      ]);

      if (detail.poolCommunity?.toLowerCase() !== communityAddress.toLowerCase()) {
        throw new Error('Pool does not belong to this community');
      }

      const factory = detail.factory?.toLowerCase();
      const isBasket = Boolean(
        contracts.BasketTVLMiningPoolFactory
        && factory === contracts.BasketTVLMiningPoolFactory.toLowerCase()
      );
      const isNft = Boolean(
        contracts.NFTMiningPoolFactory
        && factory === contracts.NFTMiningPoolFactory.toLowerCase()
      );
      if (!isBasket && !isNft) throw new Error('Unsupported mining pool type');

      setPool({
        id: ethers.getAddress(poolAddress),
        name: detail.name,
        poolType: isBasket ? 'BASKET_TVL_MINING' : 'NFT_MINING',
        ratio: Number(detail.ratio || 0),
        status: detail.active ? 'OPENED' : 'CLOSED',
      });
      setCommunityOwner(detail.owner || '');
      if (isBasket) {
        setBasketInitialData({
          name: detail.name,
          nftMiningPool: detail.nftMiningPool,
          lockDuration: detail.lockDuration || 0n,
          nftRewardBps: Number(detail.nftRewardBps || 0),
          totalNav: detail.totalNav || 0n,
          operationFee: detail.operationFee || 0n,
        });
      }
      setLoading(false);

      const tokenInterface = new ethers.Interface(ERC20ABI);
      multicallRead(readProvider, contracts.Multicall3, [
        { key: 'name', target: detail.communityToken, contractInterface: tokenInterface, functionName: 'name' },
        { key: 'symbol', target: detail.communityToken, contractInterface: tokenInterface, functionName: 'symbol' },
        { key: 'decimals', target: detail.communityToken, contractInterface: tokenInterface, functionName: 'decimals' },
      ]).then(token => {
        setCommunityToken({
          address: detail.communityToken,
          name: token.name,
          symbol: token.symbol,
          decimals: Number(token.decimals),
        });
      }).catch(error => {
        console.error('Failed to load community token metadata:', error);
      });
    } catch (error) {
      console.error('Failed to load mining pool detail:', error);
      setPool(null);
      setLoading(false);
    }
  }, [
    communityAddress,
    contracts.BasketTVLMiningPoolFactory,
    contracts.Committee,
    contracts.Multicall3,
    contracts.NFTMiningPoolFactory,
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
  const isSupportedPool = isBasketPool || pool?.poolType === 'NFT_MINING';
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
          initialData={basketInitialData}
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
