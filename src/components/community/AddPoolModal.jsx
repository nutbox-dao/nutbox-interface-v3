import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../../contexts/Web3Context';
import { useToast } from '../../contexts/ToastContext';
import { CONTRACTS } from '../../config/contracts';
import { CommunityABI } from '../../config/abis';
import { getPoolTypeLabel, getPoolTypeBadgeClass } from '../../utils/helpers';

export default function AddPoolModal({ communityAddress, activePools, onClose, onSuccess }) {
  const { signer, readProvider } = useWeb3();
  const toast = useToast();

  const [poolType, setPoolType] = useState('staking');
  const [poolName, setPoolName] = useState('');
  const [stakeTokenAddress, setStakeTokenAddress] = useState('');
  const [lockDuration, setLockDuration] = useState('');
  const [inputRatios, setInputRatios] = useState([]);
  const [loading, setLoading] = useState(false);

  // Initialize pool ratios to empty strings when activePools changes
  useEffect(() => {
    if (!activePools) return;
    const numPools = activePools.length + 1;
    setInputRatios(Array(numPools).fill(''));
  }, [activePools]);

  const handleRatioChange = (idx, valStr) => {
    setInputRatios(prev => {
      const next = [...prev];
      next[idx] = valStr;
      return next;
    });
  };

  const getSumPercent = () => {
    return inputRatios.reduce((sum, val) => {
      const num = parseFloat(val);
      return sum + (isNaN(num) ? 0 : num);
    }, 0);
  };

  const handleCreate = async () => {
    if (!signer || !poolName || !stakeTokenAddress) {
      toast.error('Please fill in all fields');
      return;
    }

    if (!ethers.isAddress(stakeTokenAddress)) {
      toast.error('Invalid token address');
      return;
    }

    // Convert and validate ratios
    const ratioArr = [];
    let sumVal = 0;
    for (let i = 0; i < inputRatios.length; i++) {
      const valStr = inputRatios[i];
      if (valStr === '') {
        toast.error('Please enter a ratio for all pools');
        return;
      }
      const pct = parseFloat(valStr);
      if (isNaN(pct) || pct < 0) {
        toast.error('Each ratio must be a non-negative number');
        return;
      }
      // Convert percent back to uint16 PPM (0 ~ 10000)
      const ratioPPM = Math.round(pct * 100);
      ratioArr.push(ratioPPM);
      sumVal += ratioPPM;
    }

    if (sumVal !== 10000 && sumVal !== 0) {
      toast.error(`Ratios must sum to 100% or 0% (current sum: ${(sumVal/100).toFixed(2)}%)`);
      return;
    }

    setLoading(true);
    try {
      const communityContract = new ethers.Contract(communityAddress, CommunityABI, signer);
      const committeeContract = new ethers.Contract(CONTRACTS.Committee, [
        'function getCommunitySettingsFee() view returns (uint256)',
      ], readProvider);

      const fee = await committeeContract.getCommunitySettingsFee();

      let factoryAddress;
      let meta;

      if (poolType === 'staking') {
        factoryAddress = CONTRACTS.ERC20StakingFactory;
        // meta: just the stake token address (20 bytes)
        meta = stakeTokenAddress.toLowerCase();
      } else {
        factoryAddress = CONTRACTS.ERC20LockingFactory;
        // meta: [address stakeToken (20 bytes)][uint256 lockDuration (32 bytes)]
        if (!lockDuration || parseInt(lockDuration) <= 0) {
          toast.error('Lock duration must be positive');
          setLoading(false);
          return;
        }
        const durationSeconds = parseInt(lockDuration) * 86400; // Convert days to seconds
        meta = stakeTokenAddress.toLowerCase() + ethers.toBeHex(durationSeconds, 32).replace('0x', '');
      }

      const tx = await communityContract.adminAddPool(
        poolName,
        ratioArr,
        factoryAddress,
        meta,
        { value: fee }
      );

      toast.info('Creating pool...');
      await tx.wait();
      toast.success('Pool created successfully!');
      onSuccess?.();
    } catch (err) {
      console.error('Create pool failed:', err);
      toast.error(err.reason || err.message || 'Failed to create pool');
    } finally {
      setLoading(false);
    }
  };

  const sumPercent = getSumPercent();
  const isValidRatios = Math.abs(sumPercent - 100) < 0.001 || sumPercent === 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Add New Pool</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {/* Pool Type */}
          <div className="input-group">
            <label>Pool Type</label>
            <select className="input" value={poolType} onChange={e => setPoolType(e.target.value)}>
              <option value="staking">ERC20 Staking</option>
              <option value="locking">ERC20 Locking</option>
            </select>
          </div>

          {/* Pool Name */}
          <div className="input-group">
            <label>Pool Name</label>
            <input
              className="input"
              placeholder="e.g. Stake USDT for rewards"
              value={poolName}
              onChange={e => setPoolName(e.target.value)}
            />
          </div>

          {/* Stake Token */}
          <div className="input-group">
            <label>Stake Token Address</label>
            <input
              className="input"
              placeholder="0x..."
              value={stakeTokenAddress}
              onChange={e => setStakeTokenAddress(e.target.value)}
            />
          </div>

          {/* Lock Duration (only for locking) */}
          {poolType === 'locking' && (
            <div className="input-group">
              <label>Lock Duration (days)</label>
              <input
                type="number"
                className="input"
                placeholder="e.g. 30"
                value={lockDuration}
                onChange={e => setLockDuration(e.target.value)}
                min="1"
              />
            </div>
          )}

          {/* Pool Ratios Section */}
          <div className="glass-card" style={{ padding: 'var(--space-4)', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px' }}>
            <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)' }}>
              📐 Set Pool Ratios (比例分配)
            </h3>
            <p style={{ fontSize: 'var(--font-size-xs)', opacity: 0.6, marginBottom: 'var(--space-4)', lineHeight: 1.4 }}>
              Set the reward percentage for all pools. The total sum must be exactly 100% (or 0% to pause distribution).
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {/* Existing Pools Inputs */}
              {activePools.map((pool, idx) => (
                <div key={pool.id || idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {pool.name || `Pool #${idx + 1}`}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                      <span className={getPoolTypeBadgeClass(pool.poolType)} style={{ fontSize: '10px', padding: '1px 6px', height: 'auto', lineHeight: 'normal' }}>
                        {getPoolTypeLabel(pool.poolType)}
                      </span>
                      <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.8, color: 'var(--color-primary)', fontWeight: 500 }}>
                        Current: {((pool.ratio || 0) / 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', width: 120 }}>
                    <input
                      type="number"
                      className="input"
                      value={inputRatios[idx] !== undefined ? inputRatios[idx] : ''}
                      onChange={e => handleRatioChange(idx, e.target.value)}
                      style={{ textAlign: 'right', paddingRight: 'var(--space-2)' }}
                      placeholder="0"
                      min="0"
                      max="100"
                      step="0.1"
                      disabled={loading}
                    />
                    <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>%</span>
                  </div>
                </div>
              ))}

              {/* New Pool Input */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', padding: 'var(--space-3)', background: 'rgba(16, 185, 129, 0.03)', border: '1px solid rgba(16, 185, 129, 0.1)', borderRadius: '8px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, display: 'block', color: 'var(--color-success)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    ✨ {poolName || 'New Pool (新矿池)'}
                  </span>
                  <span className="badge badge-active" style={{ fontSize: '10px', padding: '1px 6px', height: 'auto', lineHeight: 'normal', background: 'var(--color-success)', color: '#fff' }}>
                    {poolType === 'staking' ? 'Staking' : 'Locking'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', width: 120 }}>
                  <input
                    type="number"
                    className="input"
                    value={inputRatios[activePools.length] !== undefined ? inputRatios[activePools.length] : ''}
                    onChange={e => handleRatioChange(activePools.length, e.target.value)}
                    style={{ textAlign: 'right', paddingRight: 'var(--space-2)', border: '1px solid rgba(16, 185, 129, 0.3)' }}
                    placeholder="0"
                    min="0"
                    max="100"
                    step="0.1"
                    disabled={loading}
                  />
                  <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>%</span>
                </div>
              </div>
            </div>

            {/* Total Sum Indicator */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 'var(--space-3)',
              borderRadius: 'var(--border-radius-md)',
              background: isValidRatios ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
              border: `1px solid ${isValidRatios ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
              marginTop: 'var(--space-4)'
            }}>
              <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>New Total Ratio Sum</span>
              <span style={{
                fontSize: 'var(--font-size-md)',
                fontWeight: 700,
                color: isValidRatios ? 'var(--color-success)' : 'var(--color-danger)'
              }}>
                {sumPercent.toFixed(1)}%
              </span>
            </div>
          </div>

          <button
            className={`btn ${isValidRatios ? 'btn-primary' : 'btn-ghost'} btn-lg`}
            onClick={handleCreate}
            disabled={loading || !poolName || !stakeTokenAddress || !isValidRatios}
            style={{ width: '100%' }}
          >
            {loading ? (
              <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Creating...</>
            ) : (
              'Create Pool'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
