import { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import IndexBrokerNFTPoolCard from '../pool/IndexBrokerNFTPoolCard';

const SECTIONS = {
  zh: [
    ['mint-amm', 'Mint & AMM 交易'],
    ['mining', '激活挖矿'],
    ['referral', '推荐升级'],
    ['about', '简介'],
  ],
  en: [
    ['mint-amm', 'Mint & AMM trading'],
    ['mining', 'Activate mining'],
    ['referral', 'Referral upgrades'],
    ['about', 'About'],
  ],
};

export default function IndexBrokerNFTWorkspace({
  pool,
  communityAddress,
  communityToken,
  isOwner,
  onRefresh,
}) {
  const { language } = useLanguage();
  const [section, setSection] = useState('mint-amm');

  if (!pool) return null;

  return (
    <div className="index-broker-workspace">
      <div className="index-broker-workspace-tabs" role="tablist" aria-label={language === 'zh' ? 'NFT 功能' : 'NFT features'}>
        {(SECTIONS[language] || SECTIONS.en).map(([value, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={section === value}
            className={section === value ? 'active' : ''}
            key={value}
            onClick={() => setSection(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <IndexBrokerNFTPoolCard
        key={pool.id}
        pool={pool}
        communityAddress={communityAddress}
        communityToken={communityToken}
        isOwner={isOwner}
        onRefresh={onRefresh}
        detail
        embedded
        section={section}
        onSectionChange={setSection}
      />
    </div>
  );
}
