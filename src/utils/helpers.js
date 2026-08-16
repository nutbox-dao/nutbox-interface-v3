import { ethers } from 'ethers';

/**
 * Format a large number with suffixes (K, M, B)
 */
export function formatCompact(value, decimals = 2) {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  if (num >= 1e9) return (num / 1e9).toFixed(decimals) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(decimals) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(decimals) + 'K';
  if (num >= 1) return num.toFixed(decimals);
  if (num > 0) return num.toFixed(Math.min(6, decimals + 4));
  return '0';
}

/**
 * Format token amount from wei with auto-precision
 */
export function formatTokenAmount(weiAmount, decimals = 18, displayDecimals = 4) {
  if (!weiAmount) return '0';
  try {
    const formatted = ethers.formatUnits(weiAmount, decimals);
    const num = parseFloat(formatted);
    if (num === 0) return '0';
    if (num < 0.0001) return '<0.0001';
    if (num >= 1e6) return formatCompact(num);
    return num.toLocaleString('en-US', {
      maximumFractionDigits: displayDecimals,
      minimumFractionDigits: 0,
    });
  } catch {
    return '0';
  }
}

/**
 * Format an already-human-readable token amount (not wei).
 * Handles fractional values that cannot be converted to BigInt directly.
 * Values below 0.1 are shown with up to 4 fraction digits so tiny amounts
 * are not collapsed to 0 or rounded up to 0.01.
 */
export function formatTokenValue(value, displayDecimals = 2) {
  const num = typeof value === 'string' ? parseFloat(value) : Number(value);
  if (!isFinite(num) || num === 0) return '0';
  const maximumFractionDigits = num < 0.1 ? Math.max(4, displayDecimals) : displayDecimals;
  return num.toLocaleString('en-US', {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  });
}

/**
 * Shorten an Ethereum address for display
 */
export function shortenAddress(address, chars = 4) {
  if (!address) return '';
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Format a timestamp to human-readable date
 */
export function formatDate(timestamp, locale = 'en-US') {
  if (!timestamp) return '';
  const d = new Date(Number(timestamp) * 1000);
  return d.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format duration in seconds to human readable
 */
export function formatDuration(seconds) {
  const s = Number(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a number of milliseconds
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get BSCScan link for address
 */
export function getBscScanUrl(addressOrTx, type = 'address', explorerUrl = 'https://bscscan.com') {
  return `${explorerUrl}/${type}/${addressOrTx}`;
}

/**
 * Determine pool type label from poolFactory address
 */
export function getPoolTypeLabel(poolType) {
  if (!poolType) return 'Unknown';
  const t = poolType.toUpperCase();
  if (t.includes('ERC20_STAKING')) return 'ERC20 Staking';
  if (t.includes('ERC20_LOCKING')) return 'ERC20 Locking';
  if (t.includes('ERC1155')) return 'ERC1155 Staking';
  if (t.includes('SP_STAKING')) return 'SP Staking';
  if (t.includes('SOCIAL')) return 'Social Curation';
  if (t.includes('INDEX_BROKER')) return 'Index Broker NFT';
  if (t.includes('NFT_MINING')) return 'NFT Mining';
  if (t.includes('BASKET_TVL')) return 'Basket TVL Mining';
  return poolType;
}

/**
 * Get pool type CSS badge class
 */
export function getPoolTypeBadgeClass(poolType) {
  if (!poolType) return 'badge';
  const t = poolType.toUpperCase();
  if (t.includes('INDEX_BROKER')) return 'badge badge-index-broker';
  if (t.includes('NFT_MINING')) return 'badge badge-nft';
  if (t.includes('BASKET_TVL')) return 'badge badge-basket';
  if (t.includes('LOCKING')) return 'badge badge-locking';
  return 'badge badge-staking';
}

/**
 * Encode MintableERC20 metadata for creating a community token
 * Layout: [uint8 nameLen][name bytes][uint8 symbolLen][symbol bytes][uint256 supply][address owner]
 */
export function encodeMintableTokenMeta(name, symbol, supplyEther, ownerAddress) {
  const nameBytes = ethers.toUtf8Bytes(name);
  const symbolBytes = ethers.toUtf8Bytes(symbol);
  const supplyWei = ethers.parseEther(supplyEther.toString());

  const parts = [];
  // nameLen (1 byte)
  parts.push(ethers.toBeHex(nameBytes.length, 1));
  // name bytes
  parts.push(ethers.hexlify(nameBytes));
  // symbolLen (1 byte)
  parts.push(ethers.toBeHex(symbolBytes.length, 1));
  // symbol bytes
  parts.push(ethers.hexlify(symbolBytes));
  // supply (32 bytes)
  parts.push(ethers.toBeHex(supplyWei, 32));
  // owner address (20 bytes)
  parts.push(ownerAddress.toLowerCase());

  // Concatenate: remove '0x' from subsequent parts
  return parts[0] + parts.slice(1).map(p => p.replace('0x', '')).join('');
}

/**
 * Encode distribution policy for LinearCalculator
 * Policy: [uint8 erasLength][uint256 startCursor, uint256 stopCursor, uint256 amount per block]...
 */
export function encodeDistributionPolicy(eras) {
  if (!eras || eras.length === 0) throw new Error('At least one era is required');

  let policy = ethers.toBeHex(eras.length, 1);
  for (const era of eras) {
    policy += ethers.toBeHex(era.startBlock, 32).replace('0x', '');
    policy += ethers.toBeHex(era.stopBlock, 32).replace('0x', '');
    policy += ethers.toBeHex(era.rewardPerBlock, 32).replace('0x', '');
  }
  return policy;
}
