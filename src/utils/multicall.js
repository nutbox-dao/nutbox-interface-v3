import { ethers } from 'ethers';
import { Multicall3ABI } from '../config/abis';

function toInterface(value) {
  return value instanceof ethers.Interface ? value : new ethers.Interface(value);
}

export async function multicallRead(provider, multicallAddress, calls) {
  if (!provider || !multicallAddress || calls.length === 0) return {};

  const prepared = calls.map(call => {
    const contractInterface = toInterface(call.contractInterface);
    return {
      ...call,
      contractInterface,
      callData: contractInterface.encodeFunctionData(call.functionName, call.args || []),
    };
  });
  const multicall = new ethers.Contract(multicallAddress, Multicall3ABI, provider);
  const results = await multicall.aggregate3.staticCall(prepared.map(call => ({
    target: call.target,
    allowFailure: call.allowFailure ?? false,
    callData: call.callData,
  })));

  return Object.fromEntries(prepared.map((call, index) => {
    const result = results[index];
    if (!result.success) return [call.key, undefined];
    const decoded = call.contractInterface.decodeFunctionResult(
      call.functionName,
      result.returnData,
    );
    return [call.key, decoded.length === 1 ? decoded[0] : decoded];
  }));
}
