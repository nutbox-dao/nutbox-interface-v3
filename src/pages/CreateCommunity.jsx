import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ethers } from 'ethers';
import { useWeb3 } from '../contexts/Web3Context';
import { useToast } from '../contexts/ToastContext';
import { CONTRACTS } from '../config/contracts';
import { CommunityFactoryABI, ERC20ABI } from '../config/abis';
import { encodeMintableTokenMeta, encodeDistributionPolicy } from '../utils/helpers';
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
  const { account, signer, readProvider, isConnected } = useWeb3();
  const toast = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

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

      toast.info('Creating community...');

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

      toast.success('Community created successfully!');

      if (communityAddress) {
        navigate(`/community/${communityAddress}`);
      } else {
        navigate('/');
      }
    } catch (err) {
      console.error('Create community failed:', err);
      toast.error(err.reason || err.message || 'Failed to create community');
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="page container">
        <div className="empty-state">
          <div className="empty-state-icon">🔗</div>
          <div className="empty-state-title">Connect Wallet</div>
          <div className="empty-state-desc">Please connect your wallet to create a community.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page container">
      <div className="create-wrapper">
        <h1 className="create-title">
          Create <span className="gradient-text">Community</span>
        </h1>
        <p className="create-subtitle">
          Deploy your own staking economy with custom reward distribution.
        </p>

        {/* Step indicators */}
        <div className="steps-indicator">
          <div className={`step-dot ${step >= 1 ? 'active' : ''}`} onClick={() => setStep(1)}>
            <span>1</span>
            <label>Token</label>
          </div>
          <div className="step-line" />
          <div className={`step-dot ${step >= 2 ? 'active' : ''}`} onClick={() => step >= 1 && setStep(2)}>
            <span>2</span>
            <label>Rewards</label>
          </div>
          <div className="step-line" />
          <div className={`step-dot ${step >= 3 ? 'active' : ''}`}>
            <span>3</span>
            <label>Confirm</label>
          </div>
        </div>

        {/* Step 1: Token Configuration */}
        {step === 1 && (
          <div className="create-step glass-card">
            <h2 className="step-title">Token Configuration</h2>

            <div className="token-mode-selector">
              <button
                className={`token-mode-btn ${tokenMode === 'mintable' ? 'active' : ''}`}
                onClick={() => setTokenMode('mintable')}
              >
                <span className="token-mode-icon">🪙</span>
                <span className="token-mode-label">Create New Token</span>
                <span className="token-mode-desc">Deploy a new mintable ERC20</span>
              </button>
              <button
                className={`token-mode-btn ${tokenMode === 'existing' ? 'active' : ''}`}
                onClick={() => setTokenMode('existing')}
              >
                <span className="token-mode-icon">📎</span>
                <span className="token-mode-label">Use Existing Token</span>
                <span className="token-mode-desc">Provide rewards from your token balance</span>
              </button>
            </div>

            {tokenMode === 'mintable' ? (
              <div className="form-fields">
                <div className="input-group">
                  <label>Token Name</label>
                  <input className="input" placeholder="e.g. My Community Token" value={newTokenName} onChange={e => setNewTokenName(e.target.value)} />
                </div>
                <div className="input-group">
                  <label>Token Symbol</label>
                  <input className="input" placeholder="e.g. MCT" value={newTokenSymbol} onChange={e => setNewTokenSymbol(e.target.value)} />
                </div>
                <div className="input-group">
                  <label>Initial Supply (tokens)</label>
                  <input type="number" className="input" placeholder="1000000" value={newTokenSupply} onChange={e => setNewTokenSupply(e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="form-fields">
                <div className="input-group">
                  <label>Token Address</label>
                  <input className="input" placeholder="0x..." value={existingToken} onChange={e => setExistingToken(e.target.value)} />
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', padding: 'var(--space-3)' }}>
                  ⚠️ You must transfer enough reward tokens to the community contract after creation.
                </div>
              </div>
            )}

            <button className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 'var(--space-4)' }} onClick={() => setStep(2)}>
              Next: Configure Rewards →
            </button>
          </div>
        )}

        {/* Step 2: Reward Distribution */}
        {step === 2 && (
          <div className="create-step glass-card">
            <h2 className="step-title">Reward Distribution Strategy</h2>

            {/* Strategy Selector Grid */}
            <div className="token-mode-selector" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 'var(--space-5)' }}>
              <button
                className={`token-mode-btn ${calculatorType === 'time' ? 'active' : ''}`}
                onClick={() => setCalculatorType('time')}
                style={{ textAlign: 'center' }}
              >
                <span className="token-mode-icon">⏱️</span>
                <span className="token-mode-label">Linear Time</span>
                <span className="token-mode-desc">Smooth rewards per second</span>
              </button>
              <button
                className={`token-mode-btn ${calculatorType === 'block' ? 'active' : ''}`}
                onClick={() => setCalculatorType('block')}
                style={{ textAlign: 'center' }}
              >
                <span className="token-mode-icon">🧱</span>
                <span className="token-mode-label">Linear Block</span>
                <span className="token-mode-desc">Rewards per BSC block</span>
              </button>
              <button
                className={`token-mode-btn ${calculatorType === 'hourly' ? 'active' : ''}`}
                onClick={() => setCalculatorType('hourly')}
                style={{ textAlign: 'center' }}
              >
                <span className="token-mode-icon">⚡</span>
                <span className="token-mode-label">Hourly Vesting</span>
                <span className="token-mode-desc">Dynamic 7-day vesting</span>
              </button>
            </div>

            {/* Detailed Strategy Description Card */}
            {calculatorType === 'time' && (
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', padding: 'var(--space-4)', background: 'rgba(124, 58, 237, 0.04)', border: '1px solid rgba(124, 58, 237, 0.1)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-6)', lineHeight: '1.5' }}>
                <h4 style={{ fontWeight: 700, color: 'var(--color-text-accent)', marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>⏱️ Time-based Linear Distribution (按时间秒释放)</h4>
                <p style={{ margin: 0 }}>
                  <strong>How it works:</strong> Reward tokens accrue steadily at a fixed speed per second. You configure one or more <strong>Eras</strong> (Emission stages) by specifying the exact start/end dates and reward speed.
                  <br /><br />
                  <strong>Ideal for:</strong> Standard yield farming and locking pools. Provides a highly predictable, calendar-aligned emission timeline completely unaffected by blockchain block time fluctuations. <em>(Highly Recommended)</em>
                </p>
              </div>
            )}

            {calculatorType === 'block' && (
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', padding: 'var(--space-4)', background: 'rgba(59, 130, 246, 0.04)', border: '1px solid rgba(59, 130, 246, 0.1)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-6)', lineHeight: '1.5' }}>
                <h4 style={{ fontWeight: 700, color: 'var(--color-text-accent)', marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>🧱 Block-based Linear Distribution (按区块数释放)</h4>
                <p style={{ margin: 0 }}>
                  <strong>How it works:</strong> Reward tokens accrue strictly on a block-by-block basis. You configure one or more <strong>Eras</strong> by specifying starting/ending block numbers and reward tokens released per block.
                  <br /><br />
                  <strong>Ideal for:</strong> DeFi protocols seeking traditional, old-school token mining architectures (like PancakeSwap MasterChef) where reward distribution speeds are structurally tied to blockchain block generation. <em>Note: On BSC, 1 block &approx; 3s (roughly 28,800 blocks per day).</em>
                </p>
              </div>
            )}

            {calculatorType === 'hourly' && (
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', padding: 'var(--space-4)', background: 'rgba(16, 185, 129, 0.04)', border: '1px solid rgba(16, 185, 129, 0.1)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-6)', lineHeight: '1.5' }}>
                <h4 style={{ fontWeight: 700, color: 'var(--color-text-accent)', marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>⚡ Dynamic Hourly Vesting (按小时动态释放)</h4>
                <p style={{ margin: 0 }}>
                  <strong>How it works:</strong> No pre-scheduled eras are configured. Instead, reward tokens are injected dynamically into the community contract over time (e.g. from transaction swap tax hooks or manual deposits). Every injected amount is automatically vested linearly to stakers over a **168-hour (7-day)** window.
                  <br /><br />
                  <strong>Ideal for:</strong> Projects utilizing transaction tax buyback-to-mining, dynamic staking models, or communities funded by ongoing protocol revenues rather than a fixed upfront supply schedule.
                </p>
              </div>
            )}

            {/* Time-based Eras Inputs */}
            {calculatorType === 'time' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {eras.map((era, index) => (
                  <div key={index} className="era-card">
                    <div className="era-header">
                      <span>Era {index + 1} (Time-based)</span>
                      {eras.length > 1 && (
                        <button className="btn btn-ghost btn-sm" onClick={() => removeEra(index)} style={{ color: 'var(--color-red)' }}>Remove</button>
                      )}
                    </div>
                    <div className="era-fields">
                      <div className="input-group">
                        <label>Start Date</label>
                        <input
                          type="datetime-local"
                          className="input"
                          value={era.startDate}
                          onChange={e => updateEra(index, 'startDate', e.target.value)}
                        />
                      </div>
                      <div className="input-group">
                        <label>End Date</label>
                        <input
                          type="datetime-local"
                          className="input"
                          value={era.endDate}
                          onChange={e => updateEra(index, 'endDate', e.target.value)}
                        />
                      </div>
                      <div className="input-group">
                        <label>Reward per Second (tokens)</label>
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
                        Duration: {Math.round((new Date(era.endDate) - new Date(era.startDate)) / 86400000)} days
                        {' · '}
                        Total Rewards: {(
                          ((new Date(era.endDate) - new Date(era.startDate)) / 1000) * parseFloat(era.rewardPerSecond || 0)
                        ).toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens
                      </div>
                    )}
                  </div>
                ))}
                <button className="btn btn-ghost" onClick={addEra} style={{ width: '100%', marginTop: 'var(--space-1)' }}>
                  + Add Era
                </button>
              </div>
            )}

            {/* Block-based Eras Inputs */}
            {calculatorType === 'block' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {blockEras.map((era, index) => (
                  <div key={index} className="era-card">
                    <div className="era-header">
                      <span>Era {index + 1} (Block-based)</span>
                      {blockEras.length > 1 && (
                        <button className="btn btn-ghost btn-sm" onClick={() => removeBlockEra(index)} style={{ color: 'var(--color-red)' }}>Remove</button>
                      )}
                    </div>
                    <div className="era-fields">
                      <div className="input-group">
                        <label>Start Block Number</label>
                        <input
                          type="number"
                          className="input"
                          placeholder="e.g. 38000000"
                          value={era.startBlock}
                          onChange={e => updateBlockEra(index, 'startBlock', e.target.value)}
                        />
                      </div>
                      <div className="input-group">
                        <label>End Block Number</label>
                        <input
                          type="number"
                          className="input"
                          placeholder="e.g. 39000000"
                          value={era.endBlock}
                          onChange={e => updateBlockEra(index, 'endBlock', e.target.value)}
                        />
                      </div>
                      <div className="input-group">
                        <label>Reward per Block (tokens)</label>
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
                        Total Blocks: {parseInt(era.endBlock) - parseInt(era.startBlock)}
                        {' · '}
                        Est. Duration: {Math.round((parseInt(era.endBlock) - parseInt(era.startBlock)) * 3 / 86400)} days
                        {' · '}
                        Total Rewards: {(
                          (parseInt(era.endBlock) - parseInt(era.startBlock)) * parseFloat(era.rewardPerBlock || 0)
                        ).toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens
                      </div>
                    )}
                  </div>
                ))}
                <button className="btn btn-ghost" onClick={addBlockEra} style={{ width: '100%', marginTop: 'var(--space-1)' }}>
                  + Add Era
                </button>
              </div>
            )}

            {/* Hourly dynamic injection info view */}
            {calculatorType === 'hourly' && (
              <div className="glass-card" style={{ padding: 'var(--space-6)', textAlign: 'center', background: 'rgba(16, 185, 129, 0.02)', border: '1px solid rgba(16, 185, 129, 0.1)', borderRadius: 'var(--radius-md)' }}>
                <span style={{ fontSize: '48px', display: 'block', marginBottom: 'var(--space-3)' }}>⚡</span>
                <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 700, color: 'var(--color-success)', marginBottom: 'var(--space-2)' }}>No Eras Configuration Required</h3>
                <p style={{ fontSize: 'var(--font-size-sm)', opacity: 0.8, maxWidth: '480px', margin: '0 auto', lineHeight: 1.5 }}>
                  Under the Hourly Vesting strategy, reward distribution starts automatically when tokens are injected into the contract (e.g. via dex swap tax hook or manually by the owner). You do not need to schedule any fixed eras upfront.
                </p>
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-6)' }}>
              <button className="btn btn-secondary btn-lg" onClick={() => setStep(1)} style={{ flex: 1 }}>
                ← Back
              </button>
              <button className="btn btn-primary btn-lg" onClick={() => setStep(3)} style={{ flex: 2 }}>
                Next: Confirm →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Confirm */}
        {step === 3 && (
          <div className="create-step glass-card">
            <h2 className="step-title">Confirm & Create</h2>

            <div className="confirm-summary">
              <div className="confirm-row">
                <span className="confirm-label">Token Mode</span>
                <span className="confirm-value">{tokenMode === 'mintable' ? 'New Mintable Token' : 'Existing Token'}</span>
              </div>
              {tokenMode === 'mintable' ? (
                <>
                  <div className="confirm-row">
                    <span className="confirm-label">Token</span>
                    <span className="confirm-value">{newTokenName} ({newTokenSymbol})</span>
                  </div>
                  <div className="confirm-row">
                    <span className="confirm-label">Initial Supply</span>
                    <span className="confirm-value">{Number(newTokenSupply).toLocaleString()}</span>
                  </div>
                </>
              ) : (
                <div className="confirm-row">
                  <span className="confirm-label">Token Address</span>
                  <span className="confirm-value" style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-xs)' }}>{existingToken}</span>
                </div>
              )}
              <div className="confirm-row">
                <span className="confirm-label">Calculator Type</span>
                <span className="confirm-value">
                  {calculatorType === 'time' && 'Linear Time (time-based)'}
                  {calculatorType === 'block' && 'Linear Block (block-based)'}
                  {calculatorType === 'hourly' && 'Hourly Vesting (dynamic injection)'}
                </span>
              </div>

              {calculatorType === 'time' && (
                <>
                  <div className="confirm-row">
                    <span className="confirm-label">Distribution Eras</span>
                    <span className="confirm-value">{eras.length}</span>
                  </div>
                  {eras.map((era, i) => (
                    <div key={i} className="confirm-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-1)' }}>
                      <span className="confirm-label">Era {i + 1}</span>
                      <span className="confirm-value" style={{ fontSize: 'var(--font-size-xs)' }}>
                        {era.startDate ? new Date(era.startDate).toLocaleString() : '—'}
                        {' → '}
                        {era.endDate ? new Date(era.endDate).toLocaleString() : '—'}
                        {' · '}
                        {era.rewardPerSecond || '0'} tokens/sec
                      </span>
                    </div>
                  ))}
                </>
              )}

              {calculatorType === 'block' && (
                <>
                  <div className="confirm-row">
                    <span className="confirm-label">Distribution Eras</span>
                    <span className="confirm-value">{blockEras.length}</span>
                  </div>
                  {blockEras.map((era, i) => (
                    <div key={i} className="confirm-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-1)' }}>
                      <span className="confirm-label">Era {i + 1}</span>
                      <span className="confirm-value" style={{ fontSize: 'var(--font-size-xs)' }}>
                        Block {era.startBlock} → Block {era.endBlock}
                        {' · '}
                        {era.rewardPerBlock || '0'} tokens/block
                      </span>
                    </div>
                  ))}
                </>
              )}

              {calculatorType === 'hourly' && (
                <div className="confirm-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-1)' }}>
                  <span className="confirm-label">Distribution Policy</span>
                  <span className="confirm-value" style={{ fontSize: 'var(--font-size-xs)', opacity: 0.8 }}>
                    Dynamic Injection enabled (ignoring pre-scheduled eras). Every injection vests smoothly over 7 days (168 hours).
                  </span>
                </div>
              )}
            </div>

            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', padding: 'var(--space-3)', background: 'var(--color-bg-glass)', borderRadius: 'var(--radius-sm)', marginTop: 'var(--space-4)' }}>
              💰 A creation fee (Tier 1) will be charged in BNB. This fee goes to the protocol treasury.
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-6)' }}>
              <button className="btn btn-secondary btn-lg" onClick={() => setStep(2)} style={{ flex: 1 }}>
                ← Back
              </button>
              <button
                className="btn btn-primary btn-lg"
                onClick={handleCreate}
                disabled={loading}
                style={{ flex: 2 }}
              >
                {loading ? (
                  <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Creating...</>
                ) : (
                  '🚀 Create Community'
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
