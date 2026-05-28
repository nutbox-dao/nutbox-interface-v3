import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../../contexts/Web3Context';
import { useToast } from '../../contexts/ToastContext';
import { CONTRACTS } from '../../config/contracts';
import { CommunityABI } from '../../config/abis';
import { useLanguage } from '../../contexts/LanguageContext';

export default function AdjustRatiosModal({ communityAddress, activePools, onClose, onSuccess }) {
  const { t, language } = useLanguage();
  const { signer, readProvider } = useWeb3();
  const toast = useToast();
  
  const [loading, setLoading] = useState(false);
  const [settingsFee, setSettingsFee] = useState(null);
  // Store pool ratios in percent (e.g. 50.00% => 50) for easier user editing
  const [ratios, setRatios] = useState({});

  // Load operation fee on mount
  useEffect(() => {
    if (!readProvider) return;
    const committeeContract = new ethers.Contract(CONTRACTS.Committee, [
      'function getCommunitySettingsFee() view returns (uint256)',
    ], readProvider);
    committeeContract.getCommunitySettingsFee().then(fee => setSettingsFee(fee)).catch(() => {});
  }, [readProvider]);

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

  const handleSave = async () => {
    if (!signer) {
      toast.error(t('common.walletNotConnected'));
      return;
    }

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
    try {
      const communityContract = new ethers.Contract(communityAddress, CommunityABI, signer);
      const committeeContract = new ethers.Contract(CONTRACTS.Committee, [
        'function getCommunitySettingsFee() view returns (uint256)',
      ], readProvider);

      const fee = await committeeContract.getCommunitySettingsFee();

      const tx = await communityContract.adminSetPoolRatios(
        ratioArr,
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', width: 120 }}>
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
              {t('adjustRatios.operationFee', { fee: ethers.formatEther(settingsFee) })}
            </div>
          )}

          <button
            className={`btn ${isValid ? 'btn-primary' : 'btn-ghost'}`}
            onClick={handleSave}
            disabled={loading || !isValid}
            style={{ width: '100%', marginTop: 'var(--space-2)' }}
          >
            {loading ? (
              <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> {language === 'zh' ? '保存中...' : 'Saving...'}</>
            ) : (
              t('adjustRatios.btnSave')
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
