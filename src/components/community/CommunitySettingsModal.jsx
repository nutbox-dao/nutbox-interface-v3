import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../../contexts/Web3Context';
import { useToast } from '../../contexts/ToastContext';
import { CONTRACTS } from '../../config/contracts';
import { CommunityABI } from '../../config/abis';
import { useLanguage } from '../../contexts/LanguageContext';

export default function CommunitySettingsModal({ communityAddress, community, retainedRevenue, communityToken, onClose, onSuccess }) {
  const { t, language } = useLanguage();
  const { signer, readProvider } = useWeb3();
  const toast = useToast();

  const [devFund, setDevFund] = useState('');
  const [feeRatioPercent, setFeeRatioPercent] = useState('');
  const [devLoading, setDevLoading] = useState(false);
  const [feeLoading, setFeeLoading] = useState(false);
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [settingsFee, setSettingsFee] = useState(0n);

  useEffect(() => {
    if (community) {
      setDevFund(community.daoFund || '');
      setFeeRatioPercent(((community.feeRatio || 0) / 100).toString());
    }
  }, [community]);

  // Load the settings fee for changing fee ratio
  useEffect(() => {
    if (!readProvider) return;
    async function loadFee() {
      try {
        const committeeContract = new ethers.Contract(CONTRACTS.Committee, [
          'function getCommunitySettingsFee() view returns (uint256)',
        ], readProvider);
        const fee = await committeeContract.getCommunitySettingsFee();
        setSettingsFee(fee);
      } catch (err) {
        console.error('Failed to load settings fee:', err);
      }
    }
    loadFee();
  }, [readProvider]);

  const handleUpdateDevFund = async () => {
    if (!signer) {
      toast.error(t('common.walletNotConnected'));
      return;
    }
    if (!ethers.isAddress(devFund)) {
      toast.error(language === 'zh' ? '无效的钱包地址' : 'Invalid Ethereum address');
      return;
    }

    setDevLoading(true);
    try {
      const communityContract = new ethers.Contract(communityAddress, CommunityABI, signer);
      
      const tx = await communityContract.adminSetDev(devFund);
      toast.info(t('settings.walletSaving'));
      await tx.wait();
      
      toast.success(t('settings.walletSaveSuccess'));
      onSuccess?.();
    } catch (err) {
      console.error('Update DAO Fund failed:', err);
      toast.error(err.reason || err.message || (language === 'zh' ? '更新DAO基金地址失败' : 'Failed to update DAO Fund'));
    } finally {
      setDevLoading(false);
    }
  };

  const handleUpdateFeeRatio = async () => {
    if (!signer) {
      toast.error(t('common.walletNotConnected'));
      return;
    }
    const percent = parseFloat(feeRatioPercent);
    if (isNaN(percent) || percent < 0 || percent > 100) {
      toast.error(language === 'zh' ? '提取比率必须是 0 到 100 之间的百分比' : 'DAO Fund Ratio must be a percentage between 0% and 100%');
      return;
    }

    // Convert percentage to PPM (0 ~ 10000)
    const ratioPPM = Math.round(percent * 100);

    setFeeLoading(true);
    try {
      const communityContract = new ethers.Contract(communityAddress, CommunityABI, signer);
      
      const tx = await communityContract.adminSetFeeRatio(ratioPPM, { value: settingsFee });
      toast.info(t('settings.ratioSaving'));
      await tx.wait();
      
      toast.success(t('settings.ratioSaveSuccess'));
      onSuccess?.();
    } catch (err) {
      console.error('Update DAO Fund Ratio failed:', err);
      toast.error(err.reason || err.message || (language === 'zh' ? '更新DAO基金提取比例失败' : 'Failed to update DAO Fund Ratio'));
    } finally {
      setFeeLoading(false);
    }
  };

  const handleWithdrawRevenue = async () => {
    if (!signer) {
      toast.error(t('common.walletNotConnected'));
      return;
    }
    setWithdrawLoading(true);
    try {
      const communityContract = new ethers.Contract(communityAddress, [
        'function adminWithdrawRevenue()',
      ], signer);
      const tx = await communityContract.adminWithdrawRevenue();
      toast.info(t('settings.revenueWithdrawing'));
      await tx.wait();
      toast.success(t('settings.revenueWithdrawSuccess'));
      onSuccess?.();
    } catch (err) {
      console.error('Withdraw revenue failed:', err);
      toast.error(err.reason || err.message || (language === 'zh' ? '提取DAO基金收益失败' : 'Failed to withdraw revenue'));
    } finally {
      setWithdrawLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2 className="modal-title">{t('settings.title')}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* Section 1: DAO Fund Address */}
          <div className="glass-card" style={{ padding: 'var(--space-4)', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 700, marginBottom: 'var(--space-3)', color: 'var(--color-primary)' }}>
              {t('settings.walletSectionTitle')}
            </h3>
            <p style={{ fontSize: 'var(--font-size-xs)', opacity: 0.7, marginBottom: 'var(--space-3)' }}>
              {t('settings.walletSectionDesc')}
            </p>
            <div className="input-group" style={{ marginBottom: 'var(--space-4)' }}>
              <label>{t('settings.walletFieldAddress')}</label>
              <input
                className="input"
                placeholder="0x..."
                value={devFund}
                onChange={e => setDevFund(e.target.value)}
                disabled={devLoading || feeLoading}
                style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-sm)' }}
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={handleUpdateDevFund}
              disabled={devLoading || feeLoading || !devFund || devFund.toLowerCase() === community?.daoFund?.toLowerCase()}
              style={{ width: '100%' }}
            >
              {devLoading ? (
                <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> {language === 'zh' ? '保存中...' : 'Saving...'}</>
              ) : (
                t('settings.walletBtnSave')
              )}
            </button>
          </div>

          {/* Section 2: DAO Fund Ratio */}
          <div className="glass-card" style={{ padding: 'var(--space-4)', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 700, marginBottom: 'var(--space-3)', color: 'var(--color-success)' }}>
              {t('settings.ratioSectionTitle')}
            </h3>
            <p style={{ fontSize: 'var(--font-size-xs)', opacity: 0.7, marginBottom: 'var(--space-3)' }}>
              {t('settings.ratioSectionDesc')}
            </p>
            <div className="input-group" style={{ marginBottom: 'var(--space-4)' }}>
              <label>
                {t('settings.ratioFieldPercent')}
                {settingsFee > 0n && (
                  <span style={{ float: 'right', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                    {t('settings.ratioOperationFee')}: {ethers.formatEther(settingsFee)} BNB
                  </span>
                )}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <input
                  type="number"
                  className="input"
                  placeholder="e.g. 5"
                  value={feeRatioPercent}
                  onChange={e => setFeeRatioPercent(e.target.value)}
                  disabled={devLoading || feeLoading}
                  min="0"
                  max="100"
                  step="0.1"
                />
                <span style={{ fontSize: 'var(--font-size-md)', fontWeight: 600 }}>%</span>
              </div>
            </div>
            <button
              className="btn btn-success"
              onClick={handleUpdateFeeRatio}
              disabled={devLoading || feeLoading || feeRatioPercent === '' || parseFloat(feeRatioPercent) === (community?.feeRatio || 0) / 100}
              style={{ width: '100%' }}
            >
              {feeLoading ? (
                <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> {language === 'zh' ? '保存中...' : 'Saving...'}</>
              ) : (
                t('settings.ratioBtnSave')
              )}
            </button>
          </div>

          {/* Section 3: DAO Fund Revenue */}
          <div className="glass-card" style={{ padding: 'var(--space-4)', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 700, marginBottom: 'var(--space-3)', color: 'var(--color-amber)' }}>
              {t('settings.revenueSectionTitle')}
            </h3>
            <p style={{ fontSize: 'var(--font-size-xs)', opacity: 0.7, marginBottom: 'var(--space-4)' }}>
              {t('settings.revenueSectionDesc')}
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
              <span style={{ fontSize: 'var(--font-size-sm)', opacity: 0.8 }}>{t('settings.revenueAccumulated')}</span>
              <span style={{ fontSize: 'var(--font-size-md)', fontWeight: 700, color: 'var(--color-success)' }}>
                {retainedRevenue !== null && retainedRevenue !== undefined ? 
                  `${ethers.formatUnits(retainedRevenue, communityToken?.decimals || 18)} ${communityToken?.symbol || t('detail.historyTokens')}` : 
                  '...'
                }
              </span>
            </div>
            <button
              className="btn btn-warning"
              onClick={handleWithdrawRevenue}
              disabled={devLoading || feeLoading || withdrawLoading || !retainedRevenue || retainedRevenue === 0n}
              style={{ width: '100%' }}
            >
              {withdrawLoading ? (
                <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> {language === 'zh' ? '提取中...' : 'Withdrawing...'}</>
              ) : (
                t('settings.revenueBtnWithdraw')
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
