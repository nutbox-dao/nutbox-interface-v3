import { keccak256, toUtf8Bytes } from 'ethers';
import { CommitteeABI, IndexBrokerNFTFactoryABI } from '../config/abis.js';
import { multicallRead } from './multicall.js';

export const INDEX_BROKER_PARTICIPATION = {
  OPEN: 'open',
  BINANCE_HANDLE: 'binance-handle',
};

export function getIndexBrokerTemplates(contracts) {
  return [
    ['open', 'burn', contracts.IndexBrokerNFTBurnTemplate],
    ['open', 'stake', contracts.IndexBrokerNFTStakeTemplate],
    ['binance-handle', 'burn', contracts.IndexBrokerNFTHandleBurnTemplate],
    ['binance-handle', 'stake', contracts.IndexBrokerNFTHandleStakeTemplate],
  ].filter(([, , address]) => address).map(([participationMode, miningMode, address]) => ({
    key: `template:${participationMode}:${miningMode}`, participationMode, miningMode, address,
  }));
}

// All creation settings and every configured template are checked in one
// aggregate3 at a fixed block. Missing required data rejects the whole snapshot.
export async function readIndexBrokerCreationContext(provider, contracts, calls) {
  const templates = getIndexBrokerTemplates(contracts);
  const blockTag = await provider.getBlockNumber();
  const result = await multicallRead(provider, contracts.Multicall3, [
    ...calls,
    ...templates.map(template => ({
      key: template.key,
      target: contracts.IndexBrokerNFTFactory,
      contractInterface: IndexBrokerNFTFactoryABI,
      functionName: 'supportedNFTTemplate',
      args: [template.address],
    })),
  ], { blockTag });
  return {
    ...result,
    blockTag,
    templateOptions: templates.map(template => ({ ...template, supported: result[template.key] === true })),
  };
}

export function selectIndexBrokerTemplate(config, options) {
  const participationMode = config.participationMode || INDEX_BROKER_PARTICIPATION.OPEN;
  const available = options.filter(option => option.participationMode === participationMode && option.supported);
  const template = available.find(option => option.miningMode === config.miningMode) || available[0];
  const miningMode = template?.miningMode || config.miningMode;
  return {
    ...config,
    participationMode,
    miningMode,
    nftTemplate: template?.address || '',
    indexMiningActivationTokenAmount: miningMode === 'stake' ? '' : config.indexMiningActivationTokenAmount,
  };
}

export function requireSupportedIndexBrokerTemplate(config, options) {
  const selected = options.find(option => option.supported
    && option.participationMode === (config.participationMode || INDEX_BROKER_PARTICIPATION.OPEN)
    && option.miningMode === config.miningMode
    && option.address.toLowerCase() === config.nftTemplate?.toLowerCase());
  if (!selected) throw new Error('The NFT template is unavailable or does not match the selected wallet access and mining mode');
  return selected;
}

export async function readIndexBrokerCreationChecks(provider, contracts, name, template) {
  const blockTag = await provider.getBlockNumber();
  const result = await multicallRead(provider, contracts.Multicall3, [
    {
      key: 'fee', target: contracts.Committee, contractInterface: CommitteeABI,
      functionName: 'getCommunitySettingsFee',
    },
    {
      key: 'reserved', target: contracts.IndexBrokerNFTFactory, contractInterface: IndexBrokerNFTFactoryABI,
      functionName: 'reservedCollectionNameHash', args: [keccak256(toUtf8Bytes(name.trim()))],
    },
    {
      key: 'templateSupported', target: contracts.IndexBrokerNFTFactory, contractInterface: IndexBrokerNFTFactoryABI,
      functionName: 'supportedNFTTemplate', args: [template.address],
    },
  ], { blockTag });
  if (!result.templateSupported) throw new Error('The selected NFT template is no longer registered in the Factory');
  return result;
}
