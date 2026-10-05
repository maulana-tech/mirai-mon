import { JsonRpcProvider, Network, type JsonRpcPayload, type JsonRpcResult } from 'ethers'

// Monad Testnet configuration
export const CHAIN_ID = 10143
export const RPC_URL = import.meta.env.VITE_MONAD_RPC_URL ?? 'https://testnet-rpc.monad.xyz'
export const EXPLORER_URL = import.meta.env.VITE_MONAD_EXPLORER_URL ?? 'https://testnet.monadscan.com'

// Mirai on Monad Testnet (deployments.json). Set VITE_MIRAI_ADDRESS="" to run the in-memory mock.
export const MIRAI_ADDRESS: string =
  import.meta.env.VITE_MIRAI_ADDRESS ?? '0x8898BB4870e9757773E3E49E4Fe0caFAa00665b1'
// Agora AUSD and its public faucet (https://docs.agora.finance/developer/contract-deployments)
export const AUSD_ADDRESS: string =
  import.meta.env.VITE_AUSD_ADDRESS ?? '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC'

// Optional Envio GraphQL endpoint for activity history; falls back to recent RPC logs.
export const INDEXER_URL: string = import.meta.env.VITE_INDEXER_URL ?? ''

export const CONTRACT_ID = MIRAI_ADDRESS
export const EXPLORER_CONTRACT_URL = `${EXPLORER_URL}/address/${MIRAI_ADDRESS}`

/**
 * Monad's public RPC allows ~50 requests/second, counting each call inside a batch, and answers the
 * excess with per-item "request limit" errors that ethers would surface as failed calls. Retrying
 * the batch with backoff keeps a busy page load (or a busy RPC) from showing as broken data.
 */
class RateLimitedProvider extends JsonRpcProvider {
  async _send(payload: JsonRpcPayload | JsonRpcPayload[]): Promise<JsonRpcResult[]> {
    for (let attempt = 0; ; attempt++) {
      const results = await super._send(payload)
      // error items arrive in the same array at runtime even though the type only names results
      const limited = results.some((r) =>
        /request limit|rate limit/i.test(String((r as { error?: { message?: string } }).error?.message ?? '')),
      )
      if (!limited || attempt >= 4) return results
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt))
    }
  }
}

// One read-only provider for the whole app; reads never touch the user's keys.
export const readProvider = new RateLimitedProvider(RPC_URL, Network.from(CHAIN_ID), { staticNetwork: true })
// Monad blocks land every ~300ms; ethers' 4s default would make confirmed payments look slow.
readProvider.pollingInterval = 500

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`
}

export function explorerAddressUrl(address: string): string {
  return `${EXPLORER_URL}/address/${address}`
}
