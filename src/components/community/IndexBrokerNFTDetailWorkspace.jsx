import { useMemo, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import IndexBrokerNFTPoolCard from '../pool/IndexBrokerNFTPoolCard';

const SECTIONS = {
  zh: [
    { value: 'mint-amm', label: 'Mint & AMM', hint: '铸造、买入或卖出 NFT' },
    { value: 'holdings', label: '持仓', hint: '查看当前钱包持有的 NFT' },
    { value: 'mining', label: '激活挖矿', hint: '指数权重与奖励' },
    { value: 'referral', label: '持有分红', hint: '等级与社区挖矿' },
    { value: 'rewards', label: '奖励与回购', hint: '注入奖励、收割与回购' },
    { value: 'about', label: '数据概览', hint: '费率、库存、合约与动态' },
    { value: 'admin', label: '管理员', hint: '矿池管理设置', ownerOnly: true },
  ],
  en: [
    { value: 'mint-amm', label: 'Mint & AMM', hint: 'Mint, buy or sell NFTs' },
    { value: 'holdings', label: 'Holdings', hint: 'View NFTs held by the connected wallet' },
    { value: 'mining', label: 'Activate mining', hint: 'Index weight and rewards' },
    { value: 'referral', label: 'Holder rewards', hint: 'Levels and community mining' },
    { value: 'rewards', label: 'Rewards & buyback', hint: 'Inject, harvest and buy back' },
    { value: 'about', label: 'Data overview', hint: 'Fees, inventory, contracts and activity' },
    { value: 'admin', label: 'Admin', hint: 'Pool administration', ownerOnly: true },
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
    <div className="index-broker-detail-workspace">
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
        <p>{current?.hint}</p>
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
