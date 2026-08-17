import { useState } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../../contexts/Web3Context';
import { useToast } from '../../contexts/ToastContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { BasketStakePoolABI, ERC20ABI } from '../../config/abis';
import { formatDate, formatTokenAmount, shortenAddress } from '../../utils/helpers';

export default function BasketStakePoolCard({
  basket,
  basketStake,
  parentPool,
  parentStatus,
  communityToken,
  operationFee,
  data,
  loading,
  onRefresh,
}) {
  const { getWriteSigner, isConnected, network } = useWeb3();
  const toast = useToast();
  const { t } = useLanguage();

  const [actionLoading, setActionLoading] = useState('');
  const [action, setAction] = useState('');
  const [amount, setAmount] = useState('');

  const childPool = basketStake.childPool;
  const tokenInfo = data?.tokenInfo || { name: '', symbol: '', decimals: 18, address: basket };
  const holderFeeInfo = data?.holderFeeInfo || { symbol: 'WETH', decimals: 18 };
  const totalStaked = data?.totalStaked || 0n;
  const userStaked = data?.userStaked || 0n;
  const userBalance = data?.userBalance || 0n;
  const allowance = data?.allowance || 0n;
  const pendingRewards = data?.pendingRewards || 0n;
  const pendingHolderFees = data?.pendingHolderFees || 0n;
  const pendingNftRewards = data?.pendingNftRewards || 0n;
  const claimable = data?.claimable || 0n;
  const redeemRequests = data?.redeemRequests || [];
  const nftOwner = data?.nftOwner || '';
  const liveError = data?.liveError || false;

  const execute = async (key, pendingMessage, successMessage, transaction) => {
    setActionLoading(key);
    try {
      const writeSigner = await getWriteSigner();
      const tx = await transaction(writeSigner);
      toast.info(pendingMessage);
      await tx.wait();
      toast.success(successMessage);
      setAmount('');
      setAction('');
      await onRefresh?.();
    } catch (error) {
      toast.error(error.shortMessage || error.reason || error.message || t('basketPool.txFailed'));
    } finally {
      setActionLoading('');
    }
  };

  const parsedAmount = (() => {
    try {
      return amount ? ethers.parseUnits(amount, tokenInfo.decimals) : 0n;
    } catch {
      return 0n;
    }
  })();
  const needsApproval = action === 'deposit' && parsedAmount > allowance;
  const invalidAmount = parsedAmount <= 0n
    || (action === 'deposit' && parsedAmount > userBalance)
    || (action === 'withdraw' && parsedAmount > userStaked);
  const suppliedFee = operationFee ?? 0n;

  const handleApprove = () => execute(
    'approve',
    t('basketPool.approving'),
    t('basketPool.approved'),
    writeSigner => new ethers.Contract(tokenInfo.address, ERC20ABI, writeSigner).approve(childPool, ethers.MaxUint256),
  );

  const handleAmountAction = () => execute(
    action,
    action === 'deposit' ? t('basketPool.depositing') : t('basketPool.withdrawing'),
    action === 'deposit' ? t('basketPool.deposited') : t('basketPool.withdrawRequested'),
    writeSigner => new ethers.Contract(childPool, BasketStakePoolABI, writeSigner)[action](
      parsedAmount,
      { value: suppliedFee },
    ),
  );

  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="basket-child-card">
      <div className="basket-child-header">
        <div>
          <span className="basket-child-kicker">{t('basketPool.basketStakePool')}</span>
          <h4>{tokenInfo.name || shortenAddress(basket)}</h4>
          <span>{tokenInfo.symbol} · NFT #{basketStake.nftTokenId.toString()}</span>
        </div>
        <div className="basket-child-nav">
          <span className="basket-nav-label">
            <span>{t('basketPool.navWeight')}</span>
            <span className="basket-nav-divider">/</span>
            <span>{t('basketPool.currentNav')}</span>
          </span>
          <strong className="basket-nav-comparison">
            <span className={`basket-mining-nav is-${basketStake.navStatus || 'unknown'}`}>
              {formatTokenAmount(basketStake.miningAmount, communityToken?.decimals || 18)}
            </span>
            <span className="basket-nav-divider">/</span>
            <span className="basket-actual-nav">
              {basketStake.actualMiningAmount === null || basketStake.actualMiningAmount === undefined
                ? '—'
                : formatTokenAmount(basketStake.actualMiningAmount, communityToken?.decimals || 18)}
            </span>
            <span className="basket-nav-unit"> {communityToken?.symbol || ''}</span>
          </strong>
        </div>
      </div>

      <div className="basket-child-stats">
        <div>
          <span>{t('basketPool.totalStaked')}</span>
          <strong>{loading ? '…' : `${formatTokenAmount(totalStaked, tokenInfo.decimals)} ${tokenInfo.symbol}`}</strong>
        </div>
        <div>
          <span>{t('basketPool.nftRewardShare')}</span>
          <strong>{(Number(parentPool.nftRewardBps) / 100).toFixed(1)}%</strong>
        </div>
        <div>
          <span>{t('basketPool.updated')}</span>
          <strong>{formatDate(basketStake.updatedAt)}</strong>
        </div>
      </div>

      {isConnected && (
        <>
          {liveError && (
            <div className="contract-field-feedback is-error">
              {t('basketPool.liveDataUnavailable')}
            </div>
          )}
          <div className="basket-user-rewards">
            <div>
              <span>{t('basketPool.yourStake')}</span>
              <strong>{formatTokenAmount(userStaked, tokenInfo.decimals)} {tokenInfo.symbol}</strong>
            </div>
            <div>
              <span>{t('basketPool.communityRewards')}</span>
              <strong>{formatTokenAmount(pendingRewards, communityToken?.decimals || 18)} {communityToken?.symbol || ''}</strong>
            </div>
            <div>
              <span>{t('basketPool.holderFees')}</span>
              <strong>{formatTokenAmount(pendingHolderFees, holderFeeInfo.decimals)} {holderFeeInfo.symbol}</strong>
            </div>
          </div>

          <div className="basket-child-actions">
            {parentStatus === 'OPENED' && (
              <button className="btn btn-primary btn-sm" onClick={() => setAction(action === 'deposit' ? '' : 'deposit')} disabled={Boolean(actionLoading)}>
                {t('basketPool.stake')}
              </button>
            )}
            {userStaked > 0n && (
              <button className="btn btn-secondary btn-sm" onClick={() => setAction(action === 'withdraw' ? '' : 'withdraw')} disabled={Boolean(actionLoading)}>
                {t('basketPool.unstake')}
              </button>
            )}
            <button
              className="btn btn-success btn-sm"
              disabled={Boolean(actionLoading) || (pendingRewards === 0n && pendingHolderFees === 0n)}
              onClick={() => execute(
                'claim',
                t('basketPool.claiming'),
                t('basketPool.claimed'),
                writeSigner => new ethers.Contract(childPool, BasketStakePoolABI, writeSigner).claimRewards({ value: suppliedFee }),
              )}
            >
              {actionLoading === 'claim' ? (
                <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> {t('basketPool.claiming')}</>
              ) : (
                t('basketPool.claimBoth')
              )}
            </button>
            {claimable > 0n && (
              <button
                className="btn btn-secondary btn-sm"
                disabled={Boolean(actionLoading)}
                onClick={() => execute(
                  'redeem',
                  t('basketPool.redeeming'),
                  t('basketPool.redeemed'),
                  writeSigner => new ethers.Contract(childPool, BasketStakePoolABI, writeSigner).redeem(),
                )}
              >
                {actionLoading === 'redeem' ? (
                  <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> {t('basketPool.redeeming')}</>
                ) : (
                  <>{t('basketPool.redeem')} {formatTokenAmount(claimable, tokenInfo.decimals)}</>
                )}
              </button>
            )}
          </div>

          {action && (
            <div className="basket-amount-form">
              <div className="basket-amount-entry">
                {action === 'deposit' && (
                  <div className="basket-wallet-balance">
                    <span>{t('basketPool.walletBalance')}</span>
                    <strong>{formatTokenAmount(userBalance, tokenInfo.decimals)} {tokenInfo.symbol}</strong>
                  </div>
                )}
                <div className="input-with-max">
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="any"
                    value={amount}
                    onChange={event => setAmount(event.target.value)}
                    placeholder="0.0"
                  />
                  <button
                    type="button"
                    onClick={() => setAmount(ethers.formatUnits(action === 'deposit' ? userBalance : userStaked, tokenInfo.decimals))}
                  >
                    MAX
                  </button>
                </div>
              </div>
              {needsApproval ? (
                <button className="btn btn-primary" onClick={handleApprove} disabled={Boolean(actionLoading) || invalidAmount}>
                  {actionLoading === 'approve' ? (
                    <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> {t('basketPool.approving')}</>
                  ) : (
                    <>{t('basketPool.approve')} {tokenInfo.symbol}</>
                  )}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={handleAmountAction} disabled={Boolean(actionLoading) || invalidAmount}>
                  {actionLoading === action ? (
                    <>
                      <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                      {action === 'deposit' ? t('basketPool.depositing') : t('basketPool.withdrawing')}
                    </>
                  ) : (
                    action === 'deposit' ? t('basketPool.confirmStake') : t('basketPool.confirmUnstake')
                  )}
                </button>
              )}
            </div>
          )}

          {redeemRequests.length > 0 && (
            <div className="basket-redeem-queue">
              <strong>{t('basketPool.unlockQueue')}</strong>
              {redeemRequests.map((request, index) => {
                const duration = Number(request.endTime - request.startTime);
                const elapsed = Math.max(0, Math.min(duration, now - Number(request.startTime)));
                const progress = duration > 0 ? (elapsed / duration) * 100 : 100;
                return (
                  <div key={`${request.startTime}-${index}`} className="basket-redeem-row">
                    <div>
                      <span>{formatTokenAmount(request.tokenAmount - request.claimed, tokenInfo.decimals)} {tokenInfo.symbol}</span>
                      <small>{progress >= 100 ? t('basketPool.fullyUnlocked') : `${progress.toFixed(1)}%`}</small>
                    </div>
                    <div className="basket-redeem-progress"><span style={{ width: `${progress}%` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="basket-nft-reward">
        <div>
          <span>{t('basketPool.nftPendingRewards')}</span>
          <strong>{formatTokenAmount(pendingNftRewards, communityToken?.decimals || 18)} {communityToken?.symbol || ''}</strong>
          <small>{t('basketPool.paidToNftOwner', { owner: shortenAddress(nftOwner) })}</small>
        </div>
        {isConnected && pendingNftRewards > 0n && (
          <button
            className="btn btn-ghost btn-sm basket-nft-claim-button"
            disabled={Boolean(actionLoading)}
            onClick={() => execute(
              'claim-nft',
              t('basketPool.claimingNft'),
              t('basketPool.claimedNft'),
              writeSigner => new ethers.Contract(childPool, BasketStakePoolABI, writeSigner).claimNftRewards({ value: suppliedFee }),
            )}
          >
            {actionLoading === 'claim-nft' ? (
              <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> {t('basketPool.claimingNft')}</>
            ) : (
              t('basketPool.claimNftRewards')
            )}
          </button>
        )}
      </div>

      <div className="basket-child-footer">
        <a href={`${network.explorerUrl}/address/${basket}`} target="_blank" rel="noopener noreferrer">{shortenAddress(basket)} ↗</a>
        <a href={`${network.explorerUrl}/address/${childPool}`} target="_blank" rel="noopener noreferrer">{t('basketPool.childContract')} ↗</a>
      </div>
    </div>
  );
}
