import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ethers } from 'ethers';
import { useWeb3 } from '../contexts/Web3Context';
import { useToast } from '../contexts/ToastContext';
import { CONTRACTS } from '../config/contracts';
import { CommunityFactoryABI, ERC20ABI } from '../config/abis';
import { encodeMintableTokenMeta, encodeDistributionPolicy } from '../utils/helpers';
import { useLanguage } from '../contexts/LanguageContext';
import './CreateCommunity.css';

// Format a Date to datetime-local string (YYYY-MM-DDTHH:mm:ss)
function toDatetimeLocal(date) {
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Returns the next full hour after now
function getNextFullHour() {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return toDatetimeLocal(next);
}

export default function CreateCommunity() {
  const { t, language } = useLanguage();
  const { account, signer, readProvider, isConnected } = useWeb3();
  const toast = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [createFee, setCreateFee] = useState(null);

  // Step 1: Token config
  const [tokenMode, setTokenMode] = useState('mintable'); // 'mintable' or 'existing'
  const [existingToken, setExistingToken] = useState('');
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenSymbol, setNewTokenSymbol] = useState('');
  const [newTokenSupply, setNewTokenSupply] = useState('1000000');

  // Step 2: Calculator selection & Eras config
  const [calculatorType, setCalculatorType] = useState('time'); // 'time', 'block', or 'hourly'
  
  // Time-based Eras
  const [eras, setEras] = useState([{
    startDate: getNextFullHour(),
    endDate: '',
    rewardPerSecond: '',
  }]);

  // Block-based Eras
  const [blockEras, setBlockEras] = useState([{
    startBlock: '',
    endBlock: '',
    rewardPerBlock: '',
  }]);

  const addEra = () => {
    const prev = eras[eras.length - 1];
    let newStartDate = '';
    if (prev?.endDate) {
      const prevEnd = new Date(prev.endDate);
      prevEnd.setSeconds(prevEnd.getSeconds() + 1);
      newStartDate = toDatetimeLocal(prevEnd);
    }
    setEras([...eras, { startDate: newStartDate, endDate: '', rewardPerSecond: '' }]);
  };

  const updateEra = (index, field, value) => {
    const newEras = [...eras];
    newEras[index][field] = value;
    setEras(newEras);
  };

  const removeEra = (index) => {
    if (eras.length <= 1) return;
    setEras(eras.filter((_, i) => i !== index));
  };

  const addBlockEra = () => {
    const prev = blockEras[blockEras.length - 1];
    let newStartBlock = '';
    if (prev?.endBlock) {
      newStartBlock = (parseInt(prev.endBlock) + 1).toString();
    }
    setBlockEras([...blockEras, { startBlock: newStartBlock, endBlock: '', rewardPerBlock: '' }]);
  };

  const updateBlockEra = (index, field, value) => {
    const newEras = [...blockEras];
    newEras[index][field] = value;
    setBlockEras(newEras);
  };

  const removeBlockEra = (index) => {
    if (blockEras.length <= 1) return;
    setBlockEras(blockEras.filter((_, i) => i !== index));
  };

  // Load creation fee on mount
  useEffect(() => {
    if (!readProvider) return;
    const committeeContract = new ethers.Contract(CONTRACTS.Committee, [
      'function getCreateCommunityFee() view returns (uint256)',
    ], readProvider);
    committeeContract.getCreateCommunityFee().then(fee => setCreateFee(fee)).catch(() => {});
  }, [readProvider]);

  const handleCreate = async () => {
    if (!signer || !account) {
      toast.error('Please connect your wallet');
      return;
    }

    // Validate based on selected calculator type
    let calculatorAddr;
    let policy;

    if (calculatorType === 'time') {
      calculatorAddr = CONTRACTS.LinearTimeCalculator;
      
      // Validate time eras
      for (let i = 0; i < eras.length; i++) {
        const era = eras[i];
        if (!era.startDate || !era.endDate || !era.rewardPerSecond) {
          toast.error(`Era ${i + 1}: All fields are required`);
          return;
        }
        const startTs = Math.floor(new Date(era.startDate).getTime() / 1000);
        const endTs = Math.floor(new Date(era.endDate).getTime() / 1000);
        if (startTs >= endTs) {
          toast.error(`Era ${i + 1}: End date must be after start date`);
          return;
        }
      }

      // Encode policy
      const policyEras = eras.map(era => ({
        startBlock: BigInt(Math.floor(new Date(era.startDate).getTime() / 1000)),
        stopBlock: BigInt(Math.floor(new Date(era.endDate).getTime() / 1000)),
        rewardPerBlock: ethers.parseEther(era.rewardPerSecond),
      }));
      policy = encodeDistributionPolicy(policyEras);

    } else if (calculatorType === 'block') {
      calculatorAddr = CONTRACTS.LinearCalculator;
      
      // Validate block eras
      for (let i = 0; i < blockEras.length; i++) {
        const era = blockEras[i];
        if (!era.startBlock || !era.endBlock || !era.rewardPerBlock) {
          toast.error(`Era ${i + 1}: All fields are required`);
          return;
        }
        const start = parseInt(era.startBlock);
        const end = parseInt(era.endBlock);
        if (isNaN(start) || isNaN(end) || start >= end) {
          toast.error(`Era ${i + 1}: End block must be greater than start block`);
          return;
        }
      }

      // Encode policy
      const policyEras = blockEras.map(era => ({
        startBlock: BigInt(era.startBlock),
        stopBlock: BigInt(era.endBlock),
        rewardPerBlock: ethers.parseEther(era.rewardPerBlock),
      }));
      policy = encodeDistributionPolicy(policyEras);

    } else {
      // Hourly Vesting (ignores scheduled policy)
      calculatorAddr = CONTRACTS.HourlyTickCalculator;
      policy = '0x';
    }

    setLoading(true);
    try {
      const factory = new ethers.Contract(CONTRACTS.CommunityFactory, CommunityFactoryABI, signer);
      const committeeContract = new ethers.Contract(CONTRACTS.Committee, [
        'function getCreateCommunityFee() view returns (uint256)',
      ], readProvider);

      const fee = await committeeContract.getCreateCommunityFee();

      let isMintable, communityToken, communityTokenFactory, tokenMeta;

      if (tokenMode === 'mintable') {
        if (!newTokenName || !newTokenSymbol || !newTokenSupply) {
          toast.error('Token name, symbol, and supply are required');
          setLoading(false);
          return;
        }
        isMintable = true;
        communityToken = ethers.ZeroAddress;
        communityTokenFactory = CONTRACTS.MintableERC20Factory;
        tokenMeta = encodeMintableTokenMeta(newTokenName, newTokenSymbol, newTokenSupply, account);
      } else {
        if (!existingToken || !ethers.isAddress(existingToken)) {
          toast.error('Valid token address is required');
          setLoading(false);
          return;
        }
        isMintable = false;
        communityToken = existingToken;
        communityTokenFactory = ethers.ZeroAddress;
        tokenMeta = '0x';
      }

      toast.info(t('create.toastCreating'));

      const tx = await factory.createCommunity(
        isMintable,
        communityToken,
        communityTokenFactory,
        tokenMeta,
        calculatorAddr,
        policy,
        { value: fee }
      );

      const receipt = await tx.wait();

      // Find CommunityCreated event
      const iface = new ethers.Interface(CommunityFactoryABI);
      let communityAddress;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === 'CommunityCreated') {
            communityAddress = parsed.args[1]; // community address
            break;
          }
        } catch { /* skip other contract logs */ }
      }

      toast.success(t('create.toastSuccess'));

      if (communityAddress) {
        navigate(`/community/${communityAddress}`);
      } else {
        navigate('/');
      }
    } catch (err) {
      console.error('Create community failed:', err);
      toast.error(err.reason || err.message || (language === 'zh' ? '创建社区失败' : 'Failed to create community'));
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="page container">
        <div className="empty-state">
          <div className="empty-state-icon">🔗</div>
          <div className="empty-state-title">{t('common.connectWallet')}</div>
          <div className="empty-state-desc">{language === 'zh' ? '请连接您的钱包以创建社区。' : 'Please connect your wallet to create a community.'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page container">
      <div className="create-wrapper">
        <h1 className="create-title">
          {language === 'zh' ? <>创建 <span className="gradient-text">社区</span></> : <>Create <span className="gradient-text">Community</span></>}
        </h1>
        <p className="create-subtitle">
          {t('create.subtitle')}
        </p>

        {/* Step indicators */}
        <div className="steps-indicator">
          <div className={`step-dot ${step >= 1 ? 'active' : ''}`} onClick={() => setStep(1)}>
            <span>1</span>
            <label>{t('create.stepToken')}</label>
          </div>
          <div className="step-line" />
          <div className={`step-dot ${step >= 2 ? 'active' : ''}`} onClick={() => step >= 1 && setStep(2)}>
            <span>2</span>
            <label>{t('create.stepRewards')}</label>
          </div>
          <div className="step-line" />
          <div className={`step-dot ${step >= 3 ? 'active' : ''}`}>
            <span>3</span>
            <label>{t('create.stepConfirm')}</label>
          </div>
        </div>

        {/* Step 1: Token Configuration */}
        {step === 1 && (
          <div className="create-step glass-card">
            <h2 className="step-title">{t('create.tokenTitle')}</h2>

            <div className="token-mode-selector">
              <button
                className={`token-mode-btn ${tokenMode === 'mintable' ? 'active' : ''}`}
                onClick={() => setTokenMode('mintable')}
              >
                <span className="token-mode-icon">🪙</span>
                <span className="token-mode-label">{t('create.tokenCreateNew')}</span>
                <span className="token-mode-desc">{t('create.tokenCreateNewDesc')}</span>
              </button>
              <button
                className={`token-mode-btn ${tokenMode === 'existing' ? 'active' : ''}`}
                onClick={() => setTokenMode('existing')}
              >
                <span className="token-mode-icon">📎</span>
                <span className="token-mode-label">{t('create.tokenUseExisting')}</span>
                <span className="token-mode-desc">{t('create.tokenUseExistingDesc')}</span>
              </button>
            </div>

            {tokenMode === 'mintable' ? (
              <div className="form-fields">
                <div className="input-group">
                  <label>{t('create.fieldName')}</label>
                  <input className="input" placeholder="e.g. My Community Token" value={newTokenName} onChange={e => setNewTokenName(e.target.value)} />
                </div>
                <div className="input-group">
                  <label>{t('create.fieldSymbol')}</label>
                  <input className="input" placeholder="e.g. MCT" value={newTokenSymbol} onChange={e => setNewTokenSymbol(e.target.value)} />
                </div>
                <div className="input-group">
                  <label>{t('create.fieldSupply')}</label>
                  <input type="number" className="input" placeholder="1000000" value={newTokenSupply} onChange={e => setNewTokenSupply(e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="form-fields">
                <div className="input-group">
                  <label>{t('create.fieldAddress')}</label>
                  <input className="input" placeholder="0x..." value={existingToken} onChange={e => setExistingToken(e.target.value)} />
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', padding: 'var(--space-3)' }}>
                  {t('create.warningExisting')}
                </div>
              </div>
            )}

            <button className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 'var(--space-4)' }} onClick={() => setStep(2)}>
              {t('create.nextStepRewards')}
            </button>
          </div>
        )}

        {/* Step 2: Reward Distribution */}
        {step === 2 && (
          <div className="create-step glass-card">
            <h2 className="step-title">{t('create.rewardsTitle')}</h2>

            {/* Strategy Selector Grid */}
            <div className="token-mode-selector" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 'var(--space-5)' }}>
              <button
                className={`token-mode-btn ${calculatorType === 'time' ? 'active' : ''}`}
                onClick={() => setCalculatorType('time')}
                style={{ textAlign: 'center' }}
              >
                <span className="token-mode-icon">⏱️</span>
                <span className="token-mode-label">{t('create.strategyTimeLabel')}</span>
                <span className="token-mode-desc">{t('create.strategyTimeDesc')}</span>
              </button>
              <button
                className={`token-mode-btn ${calculatorType === 'block' ? 'active' : ''}`}
                onClick={() => setCalculatorType('block')}
                style={{ textAlign: 'center' }}
              >
                <span className="token-mode-icon">🧱</span>
                <span className="token-mode-label">{t('create.strategyBlockLabel')}</span>
                <span className="token-mode-desc">{t('create.strategyBlockDesc')}</span>
              </button>
              <button
                className={`token-mode-btn ${calculatorType === 'hourly' ? 'active' : ''}`}
                onClick={() => setCalculatorType('hourly')}
                style={{ textAlign: 'center' }}
              >
                <span className="token-mode-icon">⚡</span>
                <span className="token-mode-label">{t('create.strategyHourlyLabel')}</span>
                <span className="token-mode-desc">{t('create.strategyHourlyDesc')}</span>
              </button>
            </div>

            {/* Detailed Strategy Description Card */}
            {calculatorType === 'time' && (
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', padding: 'var(--space-4)', background: 'rgba(124, 58, 237, 0.04)', border: '1px solid rgba(124, 58, 237, 0.1)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-6)', lineHeight: '1.5' }}>
                <h4 style={{ fontWeight: 700, color: 'var(--color-text-accent)', marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>{t('create.guideTimeTitle')}</h4>
                <p style={{ margin: 0 }}>
                  <strong>{language === 'zh' ? '运行机制：' : 'How it works: '}</strong>{t('create.guideTimeDesc')}
                  <br /><br />
                  <strong>{language === 'zh' ? '适用场景：' : 'Ideal for: '}</strong><em>{t('create.guideTimeIdeal')}</em>
                </p>
              </div>
            )}

            {calculatorType === 'block' && (
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', padding: 'var(--space-4)', background: 'rgba(59, 130, 246, 0.04)', border: '1px solid rgba(59, 130, 246, 0.1)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-6)', lineHeight: '1.5' }}>
                <h4 style={{ fontWeight: 700, color: 'var(--color-text-accent)', marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>{t('create.guideBlockTitle')}</h4>
                <p style={{ margin: 0 }}>
                  <strong>{language === 'zh' ? '运行机制：' : 'How it works: '}</strong>{t('create.guideBlockDesc')}
                  <br /><br />
                  <strong>{language === 'zh' ? '适用场景：' : 'Ideal for: '}</strong><em>{t('create.guideBlockIdeal')}</em>
                </p>
              </div>
            )}

            {calculatorType === 'hourly' && (
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', padding: 'var(--space-4)', background: 'rgba(16, 185, 129, 0.04)', border: '1px solid rgba(16, 185, 129, 0.1)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-6)', lineHeight: '1.5' }}>
                <h4 style={{ fontWeight: 700, color: 'var(--color-text-accent)', marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>{t('create.guideHourlyTitle')}</h4>
                <p style={{ margin: 0 }}>
                  <strong>{language === 'zh' ? '运行机制：' : 'How it works: '}</strong>{t('create.guideHourlyDesc')}
                  <br /><br />
                  <strong>{language === 'zh' ? '适用场景：' : 'Ideal for: '}</strong><em>{t('create.guideHourlyIdeal')}</em>
                </p>
              </div>
            )}

            {/* Time-based Eras Inputs */}
            {calculatorType === 'time' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {eras.map((era, index) => (
                  <div key={index} className="era-card">
                    <div className="era-header">
                      <span>{t('create.eraTitleTime', { num: index + 1 })}</span>
                      {eras.length > 1 && (
                        <button className="btn btn-ghost btn-sm" onClick={() => removeEra(index)} style={{ color: 'var(--color-red)' }}>{t('create.eraRemoveBtn')}</button>
                      )}
                    </div>
                    <div className="era-fields">
                      <div className="input-group">
                        <label>{t('create.labelStartDate')}</label>
                        <input
                          type="datetime-local"
                          className="input"
                          value={era.startDate}
                          onChange={e => updateEra(index, 'startDate', e.target.value)}
                        />
                      </div>
                      <div className="input-group">
                        <label>{t('create.labelEndDate')}</label>
                        <input
                          type="datetime-local"
                          className="input"
                          value={era.endDate}
                          onChange={e => updateEra(index, 'endDate', e.target.value)}
                        />
                      </div>
                      <div className="input-group">
                        <label>{t('create.labelRewardPerSec')}</label>
                        <input
                          type="number"
                          className="input"
                          placeholder="e.g. 0.01"
                          value={era.rewardPerSecond}
                          onChange={e => updateEra(index, 'rewardPerSecond', e.target.value)}
                          step="any"
                        />
                      </div>
                    </div>
                    {era.startDate && era.endDate && era.rewardPerSecond && (
                      <div className="era-summary">
                        {t('create.summaryDurationDays', { num: Math.round((new Date(era.endDate) - new Date(era.startDate)) / 86400000) })}
                        {' · '}
                        {t('create.summaryTotalRewards', { num: (((new Date(era.endDate) - new Date(era.startDate)) / 1000) * parseFloat(era.rewardPerSecond || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 }) })}
                      </div>
                    )}
                  </div>
                ))}
                <button className="btn btn-ghost" onClick={addEra} style={{ width: '100%', marginTop: 'var(--space-1)' }}>
                  {t('create.eraAddBtn')}
                </button>
              </div>
            )}

            {/* Block-based Eras Inputs */}
            {calculatorType === 'block' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {blockEras.map((era, index) => (
                  <div key={index} className="era-card">
                    <div className="era-header">
                      <span>{t('create.eraTitleBlock', { num: index + 1 })}</span>
                      {blockEras.length > 1 && (
                        <button className="btn btn-ghost btn-sm" onClick={() => removeBlockEra(index)} style={{ color: 'var(--color-red)' }}>{t('create.eraRemoveBtn')}</button>
                      )}
                    </div>
                    <div className="era-fields">
                      <div className="input-group">
                        <label>{t('create.labelStartBlock')}</label>
                        <input
                          type="number"
                          className="input"
                          placeholder="e.g. 38000000"
                          value={era.startBlock}
                          onChange={e => updateBlockEra(index, 'startBlock', e.target.value)}
                        />
                      </div>
                      <div className="input-group">
                        <label>{t('create.labelEndBlock')}</label>
                        <input
                          type="number"
                          className="input"
                          placeholder="e.g. 39000000"
                          value={era.endBlock}
                          onChange={e => updateBlockEra(index, 'endBlock', e.target.value)}
                        />
                      </div>
                      <div className="input-group">
                        <label>{t('create.labelRewardPerBlock')}</label>
                        <input
                          type="number"
                          className="input"
                          placeholder="e.g. 0.5"
                          value={era.rewardPerBlock}
                          onChange={e => updateBlockEra(index, 'rewardPerBlock', e.target.value)}
                          step="any"
                        />
                      </div>
                    </div>
                    {era.startBlock && era.endBlock && era.rewardPerBlock && (
                      <div className="era-summary">
                        {t('create.summaryTotalBlocks', { num: parseInt(era.endBlock) - parseInt(era.startBlock) })}
                        {' · '}
                        {t('create.summaryEstDuration', { num: Math.round((parseInt(era.endBlock) - parseInt(era.startBlock)) * 3 / 86400) })}
                        {' · '}
                        {t('create.summaryTotalRewards', { num: ((parseInt(era.endBlock) - parseInt(era.startBlock)) * parseFloat(era.rewardPerBlock || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 }) })}
                      </div>
                    )}
                  </div>
                ))}
                <button className="btn btn-ghost" onClick={addBlockEra} style={{ width: '100%', marginTop: 'var(--space-1)' }}>
                  {t('create.eraAddBtn')}
                </button>
              </div>
            )}

            {/* Hourly dynamic injection info view */}
            {calculatorType === 'hourly' && (
              <div className="glass-card" style={{ padding: 'var(--space-6)', textAlign: 'center', background: 'rgba(16, 185, 129, 0.02)', border: '1px solid rgba(16, 185, 129, 0.1)', borderRadius: 'var(--radius-md)' }}>
                <span style={{ fontSize: '48px', display: 'block', marginBottom: 'var(--space-3)' }}>⚡</span>
                <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 700, color: 'var(--color-success)', marginBottom: 'var(--space-2)' }}>{t('create.hourlyNoEraTitle')}</h3>
                <p style={{ fontSize: 'var(--font-size-sm)', opacity: 0.8, maxWidth: '480px', margin: '0 auto', lineHeight: 1.5 }}>
                  {t('create.hourlyNoEraDesc')}
                </p>
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-6)' }}>
              <button className="btn btn-secondary btn-lg" onClick={() => setStep(1)} style={{ flex: 1 }}>
                {t('create.btnBack')}
              </button>
              <button className="btn btn-primary btn-lg" onClick={() => setStep(3)} style={{ flex: 2 }}>
                {t('create.btnNextConfirm')}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Confirm */}
        {step === 3 && (
          <div className="create-step glass-card">
            <h2 className="step-title">{t('create.confirmTitle')}</h2>

            <div className="confirm-summary">
              <div className="confirm-row">
                <span className="confirm-label">{t('create.confirmTokenMode')}</span>
                <span className="confirm-value">{tokenMode === 'mintable' ? t('create.confirmTokenModeMintable') : t('create.confirmTokenModeExisting')}</span>
              </div>
              {tokenMode === 'mintable' ? (
                <>
                  <div className="confirm-row">
                    <span className="confirm-label">{t('create.confirmTokenLabel')}</span>
                    <span className="confirm-value">{newTokenName} ({newTokenSymbol})</span>
                  </div>
                  <div className="confirm-row">
                    <span className="confirm-label">{t('create.confirmSupplyLabel')}</span>
                    <span className="confirm-value">{Number(newTokenSupply).toLocaleString()}</span>
                  </div>
                </>
              ) : (
                <div className="confirm-row">
                  <span className="confirm-label">{t('create.confirmAddressLabel')}</span>
                  <span className="confirm-value" style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-xs)' }}>{existingToken}</span>
                </div>
              )}
              <div className="confirm-row">
                <span className="confirm-label">{t('create.confirmCalculatorLabel')}</span>
                <span className="confirm-value">
                  {calculatorType === 'time' && `${t('create.strategyTimeLabel')} (${language === 'zh' ? '按秒释放' : 'time-based'})`}
                  {calculatorType === 'block' && `${t('create.strategyBlockLabel')} (${language === 'zh' ? '按区块释放' : 'block-based'})`}
                  {calculatorType === 'hourly' && `${t('create.strategyHourlyLabel')} (${language === 'zh' ? '按小时动态释放' : 'dynamic injection'})`}
                </span>
              </div>

              {calculatorType === 'time' && (
                <>
                  <div className="confirm-row">
                    <span className="confirm-label">{t('create.confirmErasLabel')}</span>
                    <span className="confirm-value">{eras.length}</span>
                  </div>
                  {eras.map((era, i) => (
                    <div key={i} className="confirm-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-1)' }}>
                      <span className="confirm-label">{language === 'zh' ? `分发阶段 ${i + 1}` : `Era ${i + 1}`}</span>
                      <span className="confirm-value" style={{ fontSize: 'var(--font-size-xs)' }}>
                        {era.startDate ? new Date(era.startDate).toLocaleString() : '—'}
                        {' → '}
                        {era.endDate ? new Date(era.endDate).toLocaleString() : '—'}
                        {' · '}
                        {era.rewardPerSecond || '0'}{language === 'zh' ? ' 代币/秒' : ' tokens/sec'}
                      </span>
                    </div>
                  ))}
                </>
              )}

              {calculatorType === 'block' && (
                <>
                  <div className="confirm-row">
                    <span className="confirm-label">{t('create.confirmErasLabel')}</span>
                    <span className="confirm-value">{blockEras.length}</span>
                  </div>
                  {blockEras.map((era, i) => (
                    <div key={i} className="confirm-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-1)' }}>
                      <span className="confirm-label">{language === 'zh' ? `分发阶段 ${i + 1}` : `Era ${i + 1}`}</span>
                      <span className="confirm-value" style={{ fontSize: 'var(--font-size-xs)' }}>
                        {language === 'zh' ? `区块` : `Block`} {era.startBlock} → {language === 'zh' ? `区块` : `Block`} {era.endBlock}
                        {' · '}
                        {era.rewardPerBlock || '0'}{language === 'zh' ? ' 代币/区块' : ' tokens/block'}
                      </span>
                    </div>
                  ))}
                </>
              )}

              {calculatorType === 'hourly' && (
                <div className="confirm-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-1)' }}>
                  <span className="confirm-label">{t('create.confirmPolicyLabel')}</span>
                  <span className="confirm-value" style={{ fontSize: 'var(--font-size-xs)', opacity: 0.8 }}>
                    {t('create.confirmPolicyHourlyDesc')}
                  </span>
                </div>
              )}
            </div>

            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', padding: 'var(--space-3)', background: 'var(--color-bg-glass)', borderRadius: 'var(--radius-sm)', marginTop: 'var(--space-4)' }}>
              {createFee !== null
                ? t('create.confirmFeeWarning', { fee: ethers.formatEther(createFee) })
                : '...'}
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-6)' }}>
              <button className="btn btn-secondary btn-lg" onClick={() => setStep(2)} style={{ flex: 1 }}>
                {t('create.btnBack')}
              </button>
              <button
                className="btn btn-primary btn-lg"
                onClick={handleCreate}
                disabled={loading}
                style={{ flex: 2 }}
              >
                {loading ? (
                  <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> {language === 'zh' ? '部署中...' : 'Creating...'}</>
                ) : (
                  t('create.btnCreateCommunity')
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
