// AUSD (Agora Dollar) utilities: a 6-decimal, EIP-2612 permit-enabled USD stablecoin

import { Contract, Signature, type ContractRunner } from 'ethers'
import { AUSD_ADDRESS, CHAIN_ID, readProvider } from '@/lib/config'
import type { MeraSigner } from '@/lib/mera-signer'

const AUSD_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function nonces(address owner) view returns (uint256)',
  'function eip712Domain() view returns (bytes1 fields,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt,uint256[] extensions)',
] as const

export const AUSD_DECIMALS = 6
export const AUSD_SCALE = 10n ** 6n

const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}

export function ausdContract(runner: ContractRunner = readProvider): Contract {
  return new Contract(AUSD_ADDRESS, AUSD_ABI, runner)
}

export async function getAusdBalance(address: string): Promise<bigint> {
  return ausdContract().balanceOf(address)
}

let domainName: Promise<{ name: string; version: string }> | null = null

/** Signs an EIP-2612 permit locally (no prompt with a Mera session) so approve + pay is one transaction. */
export async function signPermit(
  signer: MeraSigner,
  spender: string,
  value: bigint,
  deadline: bigint,
): Promise<Signature> {
  const token = ausdContract()
  domainName ??= token.eip712Domain().then((d: { name: string; version: string }) => ({
    name: d.name,
    version: d.version,
  }))
  const [{ name, version }, nonce] = await Promise.all([domainName, token.nonces(signer.address)])
  const signature = await signer.signTypedData(
    { name, version, chainId: CHAIN_ID, verifyingContract: AUSD_ADDRESS },
    PERMIT_TYPES,
    { owner: signer.address, spender, value, nonce, deadline },
  )
  return Signature.from(signature)
}
