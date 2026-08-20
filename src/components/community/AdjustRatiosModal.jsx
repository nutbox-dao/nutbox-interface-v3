import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../../contexts/Web3Context';
import { useToast } from '../../contexts/ToastContext';
import { CommunityABI } from '../../config/abis';
import { useLanguage } from '../../contexts/LanguageContext';
import useTimedActionLoading from '../../hooks/useTimedActionLoading';
import './AdjustRatiosModal.css';

function poolDisplayName(pool) {
  return pool.name || `Pool #${pool.index ?? pool.poolIndex ?? ''}`;
}

export default function AdjustRatiosModal({ communityAddress, activePools, onClose, onSuccess }) {
  const { t, language } = useLanguage();
  const { getWriteSigner, readProvider, contracts, network } = useWeb3();
  const toast = useToast();
  
  const [loading, setLoading] = useTimedActionLoading(false);
  const [settingsFee, setSettingsFee] = useState(null);
  const [pendingAction, setPendingAction] = useState('');
  const [closeTarget, setCloseTarget] = useState(null);
  const [closeNameInput, setCloseNameInput] = useState('');
  // Store pool ratios in percent (e.g. 50.00% => 50) for easier user editing
  const [ratios, setRatios] = useState({});

  // Load operation fee on mount
  useEffect(() => {
    if (!readProvider) return;
    const committeeContract = new ethers.Contract(contracts.Committee, [
      'function getCommunitySettingsFee() view returns (uint256)',
    ], readProvider);
    committeeContract.getCommunitySettingsFee().then(fee => setSettingsFee(fee)).catch(() => {});
  }, [readProvider, contracts]);

  useEffect(() => {
    if (!activePools) return;
    const initialRatios = {};
    activePools.forEach(pool => {
      // pool.ratio is out of 10000, convert to percentage out of 100
      initialRatios[pool.id] = (pool.ratio || 0) / 100;
    });
    setRatios(initialRatios);
  }, [activePools]);

  const handleRatioChange = (poolId, valStr) => {
    // allow floats or empty string for editing
    setRatios(prev => ({
      ...prev,
      [poolId]: valStr,
    }));
  };

  const getSumPercent = () => {
    return Object.values(ratios).reduce((sum, val) => {
      const num = parseFloat(val);
      return sum + (isNaN(num) ? 0 : num);
    }, 0);
  };

  const ratioToBps = (pool) => {
    const pct = parseFloat(ratios[pool.id]);
    if (isNaN(pct) || pct < 0) return null;
    return Math.round(pct * 100);
  };

  const isZeroRatio = (pool) => {
    const value = String(ratios[pool.id] ?? '').trim();
    return value !== '' && Number(value) === 0;
  };

  const getRemainingRatioState = (target) => {
    let sum = 0;
    for (const pool of activePools) {
      if (pool.id.toLowerCase() === target.id.toLowerCase()) continue;
      const bps = ratioToBps(pool);
      if (bps === null) return { valid: false, sum: 0 };
      sum += bps;
    }
    return { valid: sum === 0 || sum === 10000, sum };
  };

  const readActivePoolOrder = async (communityContract) => {
    const addresses = await Promise.all(
      activePools.map((_, index) => communityContract.activedPools(index)),
    );
    const activeSet = new Set(activePools.map(pool => pool.id.toLowerCase()));
    if (addresses.length !== activeSet.size || addresses.some(item => !activeSet.has(item.toLowerCase()))) {
      throw new Error(language === 'zh'
        ? '活动矿池列表已发生变化，请关闭弹窗后重试'
        : 'The active pool list changed. Close this dialog and try again.');
    }
    return addresses;
  };

  const handleSave = async () => {
    // Convert and validate ratios
    const ratioArr = [];
    let sumVal = 0;
    for (let i = 0; i < activePools.length; i++) {
      const pool = activePools[i];
      const pct = parseFloat(ratios[pool.id]);
      if (isNaN(pct) || pct < 0) {
        toast.error(language === 'zh' ? '每个比例必须是非负数' : 'Each ratio must be a non-negative number');
        return;
      }
      // Convert percent back to uint16 PPM (0 ~ 10000)
      const ratioPPM = Math.round(pct * 100);
      ratioArr.push(ratioPPM);
      sumVal += ratioPPM;
    }

    if (sumVal !== 10000 && sumVal !== 0) {
      toast.error(language === 'zh' ? `所有比例之和必须为 100% 或 0%（当前和：${(sumVal/100).toFixed(2)}%）` : `Ratios must sum to 100% or 0% (current sum: ${(sumVal/100).toFixed(2)}%)`);
      return;
    }

    setLoading(true);
    setPendingAction('save');
    try {
      const writeSigner = await getWriteSigner();
      const communityContract = new ethers.Contract(communityAddress, CommunityABI, writeSigner);
      const committeeContract = new ethers.Contract(contracts.Committee, [
        'function getCommunitySettingsFee() view returns (uint256)',
      ], readProvider);

      const fee = await committeeContract.getCommunitySettingsFee();

      const ratiosByAddress = new Map(activePools.map((pool, index) => [
        pool.id.toLowerCase(), ratioArr[index],
      ]));
      const onChainPoolOrder = await readActivePoolOrder(communityContract);
      const orderedRatios = onChainPoolOrder.map(poolAddress => ratiosByAddress.get(poolAddress.toLowerCase()));
      const tx = await communityContract.adminSetPoolRatios(
        orderedRatios,
        { value: fee }
      );

      toast.info(t('adjustRatios.toastSaving'));
      await tx.wait();
      toast.success(t('adjustRatios.toastSuccess'));
      onSuccess?.();
    } catch (err) {
      console.error('Update pool ratios failed:', err);
      toast.error(err.reason || err.message || (language === 'zh' ? '修改比例失败' : 'Failed to update ratios'));
    } finally {
      setLoading(false);
      setPendingAction('');
    }
  };

  const openCloseConfirmation = (pool) => {
    setCloseTarget(pool);
    setCloseNameInput('');
  };

  const dismissCloseConfirmation = () => {
    if (loading) return;
    setCloseTarget(null);
    setCloseNameInput('');
  };

  const handleClosePool = async () => {
    if (!closeTarget || closeNameInput !== poolDisplayName(closeTarget)) return;
    const remainingState = getRemainingRatioState(closeTarget);
    if (!remainingState.valid) {
      toast.error(t('adjustRatios.closeRatiosInvalid'));
      return;
    }

    setLoading(true);
    setPendingAction('close');
    try {
      const writeSigner = await getWriteSigner();
      const communityContract = new ethers.Contract(communityAddress, CommunityABI, writeSigner);
      const committeeContract = new ethers.Contract(contracts.Committee, [
        'function getCommunitySettingsFee() view returns (uint256)',
      ], readProvider);
      const [fee, onChainPoolOrder] = await Promise.all([
        committeeContract.getCommunitySettingsFee(),
        readActivePoolOrder(communityContract),
      ]);
      const closeIndex = onChainPoolOrder.findIndex(
        address => address.toLowerCase() === closeTarget.id.toLowerCase(),
      );
      if (closeIndex < 0) {
        throw new Error(language === 'zh' ? '未找到要关闭的活动矿池' : 'The active pool was not found');
      }

      const ratiosByAddress = new Map(activePools.map(pool => [
        pool.id.toLowerCase(), ratioToBps(pool),
      ]));
      const remainingRatios = onChainPoolOrder
        .filter((_, index) => index !== closeIndex)
        .map(address => ratiosByAddress.get(address.toLowerCase()));
      const sum = remainingRatios.reduce((total, value) => total + value, 0);
      if (remainingRatios.some(value => value === null || value === undefined) || (sum !== 0 && sum !== 10000)) {
        throw new Error(t('adjustRatios.closeRatiosInvalid'));
      }

      const tx = await communityContract.adminClosePool(closeIndex, remainingRatios, { value: fee });
      toast.info(t('adjustRatios.toastClosing', { name: poolDisplayName(closeTarget) }));
      await tx.wait();
      toast.success(t('adjustRatios.toastCloseSuccess', { name: poolDisplayName(closeTarget) }));
      onSuccess?.();
    } catch (err) {
      console.error('Close pool failed:', err);
      toast.error(err.reason || err.message || t('adjustRatios.closeFailed'));
    } finally {
      setLoading(false);
      setPendingAction('');
    }
  };

  const sumPercent = getSumPercent();
  const isValid = Math.abs(sumPercent - 100) < 0.001 || sumPercent === 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h2 className="modal-title">{t('adjustRatios.title')}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <p style={{ fontSize: 'var(--font-size-xs)', opacity: 0.7, lineHeight: 1.4 }}>
            {t('adjustRatios.desc')}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {activePools.map(pool => (
              <div key={pool.id} className="input-group" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', padding: 'var(--space-2) 0' }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, display: 'block' }}>
                    {pool.name || `Pool #${pool.index}`}
                  </span>
                  <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.5 }}>
                    {pool.poolType}
                  </span>
                </div>
                <div className="adjust-ratio-input-actions">
                  <input
                    type="number"
                    className="input"
                    value={ratios[pool.id] !== undefined ? ratios[pool.id] : ''}
                    onChange={e => handleRatioChange(pool.id, e.target.value)}
                    style={{ textAlign: 'right', paddingRight: 'var(--space-2)' }}
                    placeholder="0"
                    min="0"
                    max="100"
                    step="0.01"
                    disabled={loading}
                  />
                  <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>%</span>
                  {isZeroRatio(pool) && (
                    <button
                      type="button"
                      className="adjust-ratio-close-trigger"
                      onClick={() => openCloseConfirmation(pool)}
                      disabled={loading}
                      aria-label={t('adjustRatios.closePoolAria', { name: poolDisplayName(pool) })}
                      title={t('adjustRatios.closePoolAria', { name: poolDisplayName(pool) })}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 'var(--space-3)',
            borderRadius: 'var(--border-radius-md)',
            background: isValid ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
            border: `1px solid ${isValid ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
            marginTop: 'var(--space-2)'
          }}>
            <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>{t('adjustRatios.totalSumLabel')}</span>
            <span style={{
              fontSize: 'var(--font-size-md)',
              fontWeight: 700,
              color: isValid ? 'var(--color-success)' : 'var(--color-danger)'
            }}>
              {sumPercent.toFixed(2)}%
            </span>
          </div>

          {settingsFee !== null && settingsFee > 0n && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', padding: 'var(--space-3)', background: 'var(--color-bg-glass)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
              {t('adjustRatios.operationFee', { fee: ethers.formatEther(settingsFee), symbol: network.nativeCurrency.symbol })}
            </div>
          )}

          <button
            className={`btn ${isValid ? 'btn-primary' : 'btn-ghost'}`}
            onClick={handleSave}
            disabled={loading || !isValid}
            style={{ width: '100%', marginTop: 'var(--space-2)' }}
          >
            {loading && pendingAction === 'save' ? (
              <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> {language === 'zh' ? '保存中...' : 'Saving...'}</>
            ) : (
              t('adjustRatios.btnSave')
            )}
          </button>
        </div>
      </div>

      {closeTarget && (() => {
        const expectedName = poolDisplayName(closeTarget);
        const nameMatches = closeNameInput === expectedName;
        const remainingState = getRemainingRatioState(closeTarget);
        return (
          <div className="modal-overlay pool-close-confirm-overlay" onClick={(event) => { event.stopPropagation(); dismissCloseConfirmation(); }}>
            <div className="modal-content pool-close-confirm" onClick={event => event.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">{t('adjustRatios.closeTitle')}</h2>
                <button className="modal-close" onClick={dismissCloseConfirmation} disabled={loading}>×</button>
              </div>

              <div className="pool-close-warning">
                <strong>{t('adjustRatios.closeIrreversibleTitle')}</strong>
                <p>{t('adjustRatios.closeIrreversibleDesc')}</p>
              </div>

              <div className="pool-close-name-block">
                <span>{t('adjustRatios.poolNameLabel')}</span>
                <strong>{expectedName}</strong>
              </div>

              <label className="input-group">
                <span className="input-label">{t('adjustRatios.confirmPoolNameLabel')}</span>
                <input
                  className={`input ${closeNameInput && !nameMatches ? 'pool-close-name-mismatch' : ''}`}
                  value={closeNameInput}
                  onChange={event => setCloseNameInput(event.target.value)}
                  placeholder={t('adjustRatios.confirmPoolNamePlaceholder')}
                  autoComplete="off"
                  disabled={loading}
                  autoFocus
                />
              </label>

              {!remainingState.valid && (
                <div className="pool-close-ratio-error">
                  {t('adjustRatios.closeRatiosInvalidWithSum', { sum: (remainingState.sum / 100).toFixed(2) })}
                </div>
              )}

              <div className="pool-close-confirm-actions">
                <button type="button" className="btn btn-secondary" onClick={dismissCloseConfirmation} disabled={loading}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleClosePool}
                  disabled={loading || !nameMatches || !remainingState.valid}
                >
                  {loading && pendingAction === 'close'
                    ? t('adjustRatios.closingPool')
                    : t('adjustRatios.confirmClosePool')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
