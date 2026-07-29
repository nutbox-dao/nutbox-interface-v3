import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ethers } from 'ethers';
import { fetchCommunity } from '../config/subgraph';
import { CommunityABI, ERC20ABI } from '../config/abis';
import { useWeb3 } from '../contexts/Web3Context';
import { useLanguage } from '../contexts/LanguageContext';
import NFTMiningPoolCard from '../components/pool/NFTMiningPoolCard';

export default function NFTMiningPoolDetail() {
  const { communityAddress, poolAddress } = useParams();
  const { account, activeChainId, readProvider } = useWeb3();
  const { t } = useLanguage();
  const [pool, setPool] = useState(null);
  const [communityToken, setCommunityToken] = useState(null);
  const [communityOwner, setCommunityOwner] = useState('');
  const [loading, setLoading] = useState(true);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const community = await fetchCommunity(communityAddress, activeChainId);
      let matchedPool = community?.pools?.find(
        item => item.id.toLowerCase() === poolAddress.toLowerCase()
      ) || null;

      if (matchedPool && readProvider) {
        const communityContract = new ethers.Contract(communityAddress, CommunityABI, readProvider);
        const isActive = await communityContract.poolActived(matchedPool.id);
        let ratio = Number(matchedPool.ratio || 0);

        if (isActive) {
          const paddedAddress = ethers.zeroPadValue(matchedPool.id, 32);
          const paddedSlot = ethers.zeroPadValue(ethers.toBeHex(10), 32);
          const storageKey = ethers.keccak256(ethers.concat([paddedAddress, paddedSlot]));
          ratio = Number(BigInt(await readProvider.getStorage(communityAddress, storageKey)));
        }

        matchedPool = {
          ...matchedPool,
          ratio,
          status: isActive ? 'OPENED' : 'CLOSED',
        };
      }

      setPool(matchedPool);
      setCommunityOwner(community?.owner?.id || '');

      if (community?.cToken) {
        const token = new ethers.Contract(community.cToken, ERC20ABI, readProvider);
        const [name, symbol, decimals] = await Promise.all([
          token.name(),
          token.symbol(),
          token.decimals(),
        ]);
        setCommunityToken({
          address: community.cToken,
          name,
          symbol,
          decimals: Number(decimals),
        });
      }
    } catch (error) {
      console.error('Failed to load NFT mining pool detail:', error);
      setPool(null);
    } finally {
      setLoading(false);
    }
  }, [activeChainId, communityAddress, poolAddress, readProvider]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const isOwner = Boolean(
    account && communityOwner && account.toLowerCase() === communityOwner.toLowerCase()
  );

  return (
    <div className="page container nft-pool-detail-page">
      <nav className="breadcrumb">
        <Link to="/">{t('detail.breadcrumbHome')}</Link>
        <span className="breadcrumb-sep">/</span>
        <Link to={`/community/${communityAddress}`}>{t('nftPool.backToCommunity')}</Link>
        <span className="breadcrumb-sep">/</span>
        <span>{pool?.name || t('nftPool.detailTitle')}</span>
      </nav>

      {loading ? (
        <div className="glass-card nft-detail-state">{t('nftPool.loadingDetail')}</div>
      ) : !pool ? (
        <div className="glass-card nft-detail-state">
          <p>{t('nftPool.poolNotFound')}</p>
          <Link className="btn btn-secondary" to={`/community/${communityAddress}`}>
            {t('nftPool.backToCommunity')}
          </Link>
        </div>
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
