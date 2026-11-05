import { ethers } from 'ethers';
import { Multicall3ABI } from '../config/abis.js';

function toInterface(value) {
  return value instanceof ethers.Interface ? value : new ethers.Interface(value);
}

export async function multicallRead(provider, multicallAddress, calls, { blockTag } = {}) {
  if (calls.length === 0) return {};
  if (!provider || !multicallAddress) throw new Error('Multicall provider or address is missing');

  const prepared = calls.map(call => {
    const contractInterface = toInterface(call.contractInterface);
    return {
      ...call,
      contractInterface,
      callData: contractInterface.encodeFunctionData(call.functionName, call.args || []),
    };
  });
  const multicall = new ethers.Contract(multicallAddress, Multicall3ABI, provider);
  const aggregateCalls = prepared.map(call => ({
    target: call.target,
    allowFailure: call.allowFailure ?? false,
    callData: call.callData,
  }));
  const results = blockTag == null
    ? await multicall.aggregate3.staticCall(aggregateCalls)
    : await multicall.aggregate3.staticCall(aggregateCalls, { blockTag });
  if (results.length !== prepared.length) throw new Error('Incomplete Multicall results');

  return Object.fromEntries(prepared.map((call, index) => {
    const result = results[index];
    if (!result.success) {
      if (!call.allowFailure) throw new Error(`Required Multicall failed: ${call.key}`);
      return [call.key, undefined];
    }
    try {
      const decoded = call.contractInterface.decodeFunctionResult(call.functionName, result.returnData);
      return [call.key, decoded.length === 1 ? decoded[0] : decoded];
    } catch (error) {
      if (!call.allowFailure) throw error;
      return [call.key, undefined];
    }
  }));
}
