import { useMemo, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import IndexBrokerNFTPoolCard from '../pool/IndexBrokerNFTPoolCard';

const SECTIONS = {
  zh: [
    { value: 'mint-amm', label: 'Mint & AMM' },
    { value: 'holdings', label: '持仓' },
    { value: 'mining', label: '激活挖矿' },
    { value: 'referral', label: '持有分红' },
    { value: 'rewards', label: '奖励与回购' },
    { value: 'about', label: '数据概览' },
    { value: 'admin', label: '管理员', ownerOnly: true },
  ],
  en: [
    { value: 'mint-amm', label: 'Mint & AMM' },
    { value: 'holdings', label: 'Holdings' },
    { value: 'mining', label: 'Activate mining' },
    { value: 'referral', label: 'Holder rewards' },
    { value: 'rewards', label: 'Rewards & buyback' },
    { value: 'about', label: 'Data overview' },
    { value: 'admin', label: 'Admin', ownerOnly: true },
  ],
};

export default function IndexBrokerNFTDetailWorkspace({
  pool,
  communityAddress,
  communityToken,
  isOwner,
  onRefresh,
}) {
  const { language } = useLanguage();
  const [section, setSection] = useState('mint-amm');
  const sections = useMemo(
    () => (SECTIONS[language] || SECTIONS.en).filter(item => !item.ownerOnly || isOwner),
    [isOwner, language],
  );
  const current = sections.find(item => item.value === section) || sections[0];
  const activeSection = current?.value || 'mint-amm';

  return (
    <div className="index-broker-detail-workspace" data-active-section={activeSection}>
      <div className="index-broker-detail-navigation glass-card">
        <div className="index-broker-detail-tabs" role="tablist" aria-label={language === 'zh' ? 'NFT 详情功能' : 'NFT detail features'}>
          {sections.map(item => (
            <button
              type="button"
              role="tab"
              aria-selected={activeSection === item.value}
              className={activeSection === item.value ? 'active' : ''}
              key={item.value}
              onClick={() => setSection(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <IndexBrokerNFTPoolCard
        pool={pool}
        communityAddress={communityAddress}
        communityToken={communityToken}
        isOwner={isOwner}
        onRefresh={onRefresh}
        detail
        organized
        section={activeSection}
        onSectionChange={setSection}
      />
    </div>
  );
}
