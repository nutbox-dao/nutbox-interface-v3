import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../../contexts/Web3Context';
import { useToast } from '../../contexts/ToastContext';
import { ERC20StakingABI, ERC20LockingABI, ERC20ABI, CommunityABI } from '../../config/abis';
import { CONTRACTS, BLOCKS_PER_YEAR } from '../../config/contracts';
import { formatTokenAmount, shortenAddress, formatDuration, getBscScanUrl, getPoolTypeLabel, getPoolTypeBadgeClass } from '../../utils/helpers';
import './PoolCard.css';

export default function PoolCard({ pool, communityAddress, communityToken, rewardRate, rewardRateUnit = '/block', feeRatio = 0, onRefresh }) {
  const { account, signer, readProvider, isConnected } = useWeb3();
  const toast = useToast();

  const [stakeTokenInfo, setStakeTokenInfo] = useState(null);
  const [totalStaked, setTotalStaked] = useState(0n);
  const [userStaked, setUserStaked] = useState(0n);
  const [userBalance, setUserBalance] = useState(0n);
  const [pendingRewards, setPendingRewards] = useState(0n);
  const [allowance, setAllowance] = useState(0n);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [stakeAmount, setStakeAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [showStake, setShowStake] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);

  // Locking specific
  const [lockDuration, setLockDuration] = useState(0n);
  const [claimable, setClaimable] = useState(0n);
  const [redeemRequests, setRedeemRequests] = useState([]);
  const [stakersCount, setStakersCount] = useState(0);
  const [poolOperationFee, setPoolOperationFee] = useState(null);

  const isLocking = pool.poolType === 'ERC20_LOCKING';
  const poolABI = isLocking ? ERC20LockingABI : ERC20StakingABI;

  const loadPoolData = useCallback(async () => {
    try {
      const poolContract = new ethers.Contract(pool.id, poolABI, readProvider);
      const communityContract = new ethers.Contract(communityAddress, CommunityABI, readProvider);

      // Get stake token address
      const stakeTokenAddr = await poolContract.stakeToken();
      const tokenContract = new ethers.Contract(stakeTokenAddr, ERC20ABI, readProvider);

      const [name, symbol, decimals, tStaked] = await Promise.all([
        tokenContract.name(),
        tokenContract.symbol(),
        tokenContract.decimals(),
        poolContract.totalStakedAmount(),
      ]);

      setStakeTokenInfo({ name, symbol, decimals: Number(decimals), address: stakeTokenAddr });
      setTotalStaked(tStaked);

      // Locking duration
      if (isLocking) {
        try {
          const dur = await poolContract.lockDuration();
          setLockDuration(dur);
        } catch { /* ignore */ }
      }

      // User data
      if (account) {
        const [uStaked, balance, allow, pending] = await Promise.all([
          poolContract.getUserStakedAmount(account),
          tokenContract.balanceOf(account),
          tokenContract.allowance(account, pool.id),
          communityContract.getPoolPendingRewards(pool.id, account).catch(() => 0n),
        ]);
        setUserStaked(uStaked);
        setUserBalance(balance);
        setAllowance(allow);
        setPendingRewards(pending);

        if (isLocking) {
          try {
            const cAmount = await poolContract.claimableAmount(account);
            setClaimable(cAmount);
            const reqs = await poolContract.redeemRequests(account);
            setRedeemRequests(reqs);
          } catch { /* ignore */ }
        }
      }

      // Calculate stakers count from contract event logs
      let sCount = 0;
      try {
        const filter = isLocking ? poolContract.filters.Locked() : poolContract.filters.Deposited();
        const logs = await poolContract.queryFilter(filter).catch(() => []);
        
        const stakers = new Set();
        for (const log of logs) {
          const who = isLocking ? log.args?.[0] : log.args?.[1];
          if (who) stakers.add(who.toLowerCase());
        }
        
        if (stakers.size > 0) {
          const balances = await Promise.all(
            Array.from(stakers).map(staker => 
              poolContract.getUserStakedAmount(staker).catch(() => 0n)
            )
          );
          sCount = balances.filter(bal => bal > 0n).length;
        } else {
          sCount = tStaked > 0n ? 1 : 0;
        }
      } catch (err) {
        console.error('Failed to load stakers count:', err);
        sCount = tStaked > 0n ? 1 : 0;
      }
      setStakersCount(sCount);
    } catch (err) {
      console.error('Failed to load pool data:', err);
    } finally {
      setLoading(false);
    }
  }, [pool.id, poolABI, communityAddress, account, readProvider, isLocking]);

  useEffect(() => {
    loadPoolData();
    // Refresh every 15 seconds
    const interval = setInterval(loadPoolData, 15000);
    return () => clearInterval(interval);
  }, [loadPoolData]);

  // Load pool operation fee once
  useEffect(() => {
    if (!readProvider) return;
    const committeeContract = new ethers.Contract(CONTRACTS.Committee, [
      'function getPoolOperationFee() view returns (uint256)',
    ], readProvider);
    committeeContract.getPoolOperationFee().then(fee => setPoolOperationFee(fee)).catch(() => {});
  }, [readProvider]);

  // Calculate APR
  const apr = (() => {
    if (!rewardRate || rewardRate === 0n || totalStaked === 0n || !communityToken || !stakeTokenInfo) return null;
    try {
      const poolRatio = BigInt(pool.ratio || 10000);

      // Determine the multiplier based on the reward rate unit
      let multiplier = BigInt(BLOCKS_PER_YEAR); // default '/block'
      if (rewardRateUnit === '/sec') {
        multiplier = 31_536_000n; // 365 * 24 * 3600
      } else if (rewardRateUnit === '/hour') {
        multiplier = 8_760n; // 365 * 24
      }

      // Staker rewards are reduced by feeRatio (DAO Fund)
      const stakerRewardRatio = 10000n - BigInt(feeRatio);
      const yearlyRewards = rewardRate * multiplier * poolRatio / 10000n * stakerRewardRatio / 10000n;

      // Simple APR: yearlyRewards / totalStaked * 100 (assuming same token for simplicity)
      const aprBps = yearlyRewards * 10000n / totalStaked;
      return Number(aprBps) / 100;
    } catch {
      return null;
    }
  })();

  const decimals = stakeTokenInfo?.decimals || 18;

  // ──── Actions ────
  const handleApprove = async () => {
    if (!signer || !stakeTokenInfo) return;
    setActionLoading('approve');
    try {
      const tokenContract = new ethers.Contract(stakeTokenInfo.address, ERC20ABI, signer);
      const tx = await tokenContract.approve(pool.id, ethers.MaxUint256);
      toast.info('Approving...');
      await tx.wait();
      toast.success('Approved!');
      loadPoolData();
    } catch (err) {
      toast.error(err.reason || err.message || 'Approval failed');
    } finally {
      setActionLoading('');
    }
  };

  const handleDeposit = async () => {
    if (!signer || !stakeAmount) return;
    setActionLoading('deposit');
    try {
      const poolContract = new ethers.Contract(pool.id, poolABI, signer);
      const committeeContract = new ethers.Contract(CONTRACTS.Committee, ['function getPoolOperationFee() view returns (uint256)'], readProvider);
      const fee = await committeeContract.getPoolOperationFee();
      const amount = ethers.parseUnits(stakeAmount, decimals);
      const tx = await poolContract.deposit(amount, { value: fee });
      toast.info(isLocking ? 'Locking...' : 'Staking...');
      await tx.wait();
      toast.success(isLocking ? 'Locked successfully!' : 'Staked successfully!');
      setStakeAmount('');
      setShowStake(false);
      loadPoolData();
      onRefresh?.();
    } catch (err) {
      toast.error(err.reason || err.message || 'Deposit failed');
    } finally {
      setActionLoading('');
    }
  };

  const handleWithdraw = async () => {
    if (!signer || !withdrawAmount) return;
    setActionLoading('withdraw');
    try {
      const poolContract = new ethers.Contract(pool.id, poolABI, signer);
      const committeeContract = new ethers.Contract(CONTRACTS.Committee, ['function getPoolOperationFee() view returns (uint256)'], readProvider);
      const fee = await committeeContract.getPoolOperationFee();
      const amount = ethers.parseUnits(withdrawAmount, decimals);
      const tx = await poolContract.withdraw(amount, { value: fee });
      toast.info(isLocking ? 'Unlocking...' : 'Withdrawing...');
      await tx.wait();
      toast.success(isLocking ? 'Unlock initiated!' : 'Withdrawn!');
      setWithdrawAmount('');
      setShowWithdraw(false);
      loadPoolData();
      onRefresh?.();
    } catch (err) {
      toast.error(err.reason || err.message || 'Withdraw failed');
    } finally {
      setActionLoading('');
    }
  };

  const handleClaimRewards = async () => {
    if (!signer) return;
    setActionLoading('claim');
    try {
      const communityContract = new ethers.Contract(communityAddress, CommunityABI, signer);
      const committeeContract = new ethers.Contract(CONTRACTS.Committee, ['function getPoolOperationFee() view returns (uint256)'], readProvider);
      const fee = await committeeContract.getPoolOperationFee();
      const tx = await communityContract.withdrawPoolsRewards([pool.id], { value: fee });
      toast.info('Claiming rewards...');
      await tx.wait();
      toast.success('Rewards claimed!');
      loadPoolData();
    } catch (err) {
      toast.error(err.reason || err.message || 'Claim failed');
    } finally {
      setActionLoading('');
    }
  };

  const handleRedeem = async () => {
    if (!signer) return;
    setActionLoading('redeem');
    try {
      const poolContract = new ethers.Contract(pool.id, ERC20LockingABI, signer);
      const tx = await poolContract.redeem();
      toast.info('Redeeming...');
      await tx.wait();
      toast.success('Redeemed!');
      loadPoolData();
    } catch (err) {
      toast.error(err.reason || err.message || 'Redeem failed');
    } finally {
      setActionLoading('');
    }
  };

  const needsApproval = stakeAmount && stakeTokenInfo
    ? allowance < ethers.parseUnits(stakeAmount || '0', decimals)
    : false;

  return (
    <div className="pool-card glass-card" id={`pool-${pool.id}`}>
      {/* Header */}
      <div className="pool-card-header">
        <div className="pool-card-title-row">
          <h3 className="pool-card-name">{pool.name || 'Pool'}</h3>
          <span className={getPoolTypeBadgeClass(pool.poolType)}>{getPoolTypeLabel(pool.poolType)}</span>
        </div>
        {pool.status === 'OPENED' ? (
          <span className="badge badge-active">Active</span>
        ) : (
          <span className="badge badge-closed">Closed</span>
        )}
      </div>

      {/* Stats */}
      <div className="pool-stats-grid">
        <div className="pool-stat">
          <div className="pool-stat-label">Total Staked</div>
          <div className="pool-stat-value">
            {loading ? <span className="skeleton" style={{ width: 80, height: 20, display: 'inline-block' }} /> :
              `${formatTokenAmount(totalStaked, decimals)} ${stakeTokenInfo?.symbol || ''}`}
          </div>
        </div>
        <div className="pool-stat">
          <div className="pool-stat-label">APR</div>
          <div className="pool-stat-value pool-apr">
            {apr !== null ? (apr > 0 ? `${apr.toFixed(1)}%` : '0%') : '—'}
          </div>
        </div>
        <div className="pool-stat">
          <div className="pool-stat-label">Pool Ratio</div>
          <div className="pool-stat-value">{((pool.ratio || 0) / 100).toFixed(1)}%</div>
        </div>
        {isLocking && (
          <div className="pool-stat">
            <div className="pool-stat-label">Lock Period</div>
            <div className="pool-stat-value">{formatDuration(pool.lockDuration || lockDuration)}</div>
          </div>
        )}
        <div className="pool-stat">
          <div className="pool-stat-label">Stakers</div>
          <div className="pool-stat-value">
            {loading ? <span className="skeleton" style={{ width: 40, height: 20, display: 'inline-block' }} /> : stakersCount}
          </div>
        </div>
        <div className="pool-stat">
          <div className="pool-stat-label">Stake Token</div>
          <div className="pool-stat-value" style={{ fontSize: 'var(--font-size-xs)', fontFamily: 'monospace' }}>
            {stakeTokenInfo ? `${stakeTokenInfo.symbol}` : shortenAddress(pool.asset)}
          </div>
        </div>
      </div>

      {/* User Section (only when connected) */}
      {isConnected && (
        <div className="pool-user-section">
          <div className="pool-user-stats">
            <div className="pool-user-stat">
              <span className="pool-user-label">Your Staked</span>
              <span className="pool-user-value">
                {formatTokenAmount(userStaked, decimals)} {stakeTokenInfo?.symbol || ''}
              </span>
            </div>
            <div className="pool-user-stat">
              <span className="pool-user-label">Pending Rewards</span>
              <span className="pool-user-value pool-rewards-value">
                {formatTokenAmount(pendingRewards, communityToken?.decimals || 18)} {communityToken?.symbol || ''}
              </span>
            </div>
          </div>

          {/* Operation fee hint */}
          {poolOperationFee !== null && poolOperationFee > 0n && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', textAlign: 'right', marginBottom: 4 }}>
              Network fee per operation: {ethers.formatEther(poolOperationFee)} BNB
            </div>
          )}

          {/* Action Buttons */}
          <div className="pool-actions">
            {pool.status === 'OPENED' && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setShowStake(!showStake)}
                disabled={!!actionLoading}
              >
                {isLocking ? '🔒 Lock' : '📥 Stake'}
              </button>
            )}
            {userStaked > 0n && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowWithdraw(!showWithdraw)}
                disabled={!!actionLoading}
              >
                {isLocking ? '🔓 Unlock' : '📤 Withdraw'}
              </button>
            )}
            {pendingRewards > 0n && (
              <button
                className="btn btn-success btn-sm"
                onClick={handleClaimRewards}
                disabled={actionLoading === 'claim'}
              >
                {actionLoading === 'claim' ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : '🎁 Claim'}
              </button>
            )}
            {isLocking && claimable > 0n && (
              <button
                className="btn btn-success btn-sm"
                onClick={handleRedeem}
                disabled={actionLoading === 'redeem'}
              >
                {actionLoading === 'redeem' ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : '✅ Redeem'}
              </button>
            )}
          </div>

          {/* Stake Input */}
          {showStake && (
            <div className="pool-action-form">
              <div className="pool-balance-info">
                Balance: {formatTokenAmount(userBalance, decimals)} {stakeTokenInfo?.symbol || ''}
              </div>
              <div className="input-with-max">
                <input
                  type="number"
                  className="input"
                  placeholder="0.0"
                  value={stakeAmount}
                  onChange={e => setStakeAmount(e.target.value)}
                  min="0"
                  step="any"
                />
                <button className="max-btn" onClick={() => setStakeAmount(ethers.formatUnits(userBalance, decimals))}>MAX</button>
              </div>
              {poolOperationFee !== null && poolOperationFee > 0n && (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', textAlign: 'center', marginTop: 4 }}>
                  Network fee: {ethers.formatEther(poolOperationFee)} BNB
                </div>
              )}
              {needsApproval ? (
                <button
                  className="btn btn-primary"
                  onClick={handleApprove}
                  disabled={actionLoading === 'approve'}
                  style={{ width: '100%' }}
                >
                  {actionLoading === 'approve' ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : `Approve ${stakeTokenInfo?.symbol || ''}`}
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={handleDeposit}
                  disabled={!stakeAmount || parseFloat(stakeAmount) <= 0 || actionLoading === 'deposit'}
                  style={{ width: '100%' }}
                >
                  {actionLoading === 'deposit' ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : (isLocking ? 'Lock Tokens' : 'Stake Tokens')}
                </button>
              )}
            </div>
          )}

          {/* Withdraw Input */}
          {showWithdraw && (
            <div className="pool-action-form">
              <div className="pool-balance-info">
                Staked: {formatTokenAmount(userStaked, decimals)} {stakeTokenInfo?.symbol || ''}
              </div>
              <div className="input-with-max">
                <input
                  type="number"
                  className="input"
                  placeholder="0.0"
                  value={withdrawAmount}
                  onChange={e => setWithdrawAmount(e.target.value)}
                  min="0"
                  step="any"
                />
                <button className="max-btn" onClick={() => setWithdrawAmount(ethers.formatUnits(userStaked, decimals))}>MAX</button>
              </div>
              {poolOperationFee !== null && poolOperationFee > 0n && (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', textAlign: 'center', marginTop: 4 }}>
                  Network fee: {ethers.formatEther(poolOperationFee)} BNB
                </div>
              )}
              <button
                className="btn btn-secondary"
                onClick={handleWithdraw}
                disabled={!withdrawAmount || parseFloat(withdrawAmount) <= 0 || actionLoading === 'withdraw'}
                style={{ width: '100%' }}
              >
                {actionLoading === 'withdraw' ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : (isLocking ? 'Initiate Unlock' : 'Withdraw')}
              </button>
              {isLocking && (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                  ⏱ Tokens will be available after {formatDuration(pool.lockDuration || lockDuration)} linear vesting
                </div>
              )}
            </div>
          )}

          {/* Locking: Redeem Queue */}
          {isLocking && redeemRequests.length > 0 && (
            <div className="redeem-queue">
              <div className="redeem-queue-title">Redeem Queue</div>
              {redeemRequests.map((req, i) => {
                const progress = req.endTime <= BigInt(Math.floor(Date.now() / 1000))
                  ? 100
                  : Number((BigInt(Math.floor(Date.now() / 1000)) - req.startTime) * 100n / (req.endTime - req.startTime));
                return (
                  <div key={i} className="redeem-item">
                    <div className="redeem-item-info">
                      <span>{formatTokenAmount(req.erc20Amount, decimals)} {stakeTokenInfo?.symbol}</span>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                        {Math.min(progress, 100).toFixed(0)}% vested
                      </span>
                    </div>
                    <div className="redeem-progress-bar">
                      <div className="redeem-progress-fill" style={{ width: `${Math.min(progress, 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Pool address footer */}
      <div className="pool-card-footer">
        <a href={getBscScanUrl(pool.id)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 'var(--font-size-xs)', fontFamily: 'monospace', color: 'var(--color-text-tertiary)' }}>
          {shortenAddress(pool.id)} ↗
        </a>
      </div>
    </div>
  );
}
