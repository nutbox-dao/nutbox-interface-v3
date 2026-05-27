import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../../contexts/Web3Context';
import { useToast } from '../../contexts/ToastContext';
import { CONTRACTS } from '../../config/contracts';
import { CommunityABI } from '../../config/abis';

export default function CommunitySettingsModal({ communityAddress, community, onClose, onSuccess }) {
  const { signer, readProvider } = useWeb3();
  const toast = useToast();

  const [devFund, setDevFund] = useState('');
  const [feeRatioPercent, setFeeRatioPercent] = useState('');
  const [devLoading, setDevLoading] = useState(false);
  const [feeLoading, setFeeLoading] = useState(false);
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
      toast.error('Wallet not connected');
      return;
    }
    if (!ethers.isAddress(devFund)) {
      toast.error('Invalid Ethereum address');
      return;
    }

    setDevLoading(true);
    try {
      const communityContract = new ethers.Contract(communityAddress, CommunityABI, signer);
      
      const tx = await communityContract.adminSetDev(devFund);
      toast.info('Updating DAO Fund address...');
      await tx.wait();
      
      toast.success('DAO Fund address updated successfully!');
      onSuccess?.();
    } catch (err) {
      console.error('Update DAO Fund failed:', err);
      toast.error(err.reason || err.message || 'Failed to update DAO Fund');
    } finally {
      setDevLoading(false);
    }
  };

  const handleUpdateFeeRatio = async () => {
    if (!signer) {
      toast.error('Wallet not connected');
      return;
    }
    const percent = parseFloat(feeRatioPercent);
    if (isNaN(percent) || percent < 0 || percent > 100) {
      toast.error('DAO Fund Ratio must be a percentage between 0% and 100%');
      return;
    }

    // Convert percentage to PPM (0 ~ 10000)
    const ratioPPM = Math.round(percent * 100);

    setFeeLoading(true);
    try {
      const communityContract = new ethers.Contract(communityAddress, CommunityABI, signer);
      
      const tx = await communityContract.adminSetFeeRatio(ratioPPM, { value: settingsFee });
      toast.info('Updating DAO Fund Ratio on-chain...');
      await tx.wait();
      
      toast.success('DAO Fund Ratio updated successfully!');
      onSuccess?.();
    } catch (err) {
      console.error('Update DAO Fund Ratio failed:', err);
      toast.error(err.reason || err.message || 'Failed to update DAO Fund Ratio');
    } finally {
      setFeeLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2 className="modal-title">⚙️ Community Settings</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* Section 1: DAO Fund Address */}
          <div className="glass-card" style={{ padding: 'var(--space-4)', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 700, marginBottom: 'var(--space-3)', color: 'var(--color-primary)' }}>
              🏛️ DAO Fund Wallet
            </h3>
            <p style={{ fontSize: 'var(--font-size-xs)', opacity: 0.7, marginBottom: 'var(--space-3)' }}>
              Change the address where DAO fund revenues are withdrawn.
            </p>
            <div className="input-group" style={{ marginBottom: 'var(--space-4)' }}>
              <label>DAO Fund Address</label>
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
                <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Saving...</>
              ) : (
                'Update DAO Fund'
              )}
            </button>
          </div>

          {/* Section 2: DAO Fund Ratio */}
          <div className="glass-card" style={{ padding: 'var(--space-4)', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 700, marginBottom: 'var(--space-3)', color: 'var(--color-success)' }}>
              🏛️ DAO Fund Ratio
            </h3>
            <p style={{ fontSize: 'var(--font-size-xs)', opacity: 0.7, marginBottom: 'var(--space-3)' }}>
              Change the percentage of community rewards allocated to the DAO Fund.
            </p>
            <div className="input-group" style={{ marginBottom: 'var(--space-4)' }}>
              <label>
                DAO Fund Ratio (%)
                {settingsFee > 0n && (
                  <span style={{ float: 'right', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                    Operation Fee: {ethers.formatEther(settingsFee)} BNB
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
                <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Saving...</>
              ) : (
                'Update DAO Fund Ratio'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
