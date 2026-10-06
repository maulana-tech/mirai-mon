import { isMeraError } from '@category-labs/mera'
import type { MessageKey } from '@/lib/i18n'

const CONTRACT_ERROR_KEYS: Record<number, MessageKey> = {
  1: 'errors.invalidAmount',
  2: 'errors.invalidSplit',
  3: 'errors.insufficientSpendable',
  4: 'errors.insufficientShares',
  5: 'errors.savingsLocked',
  6: 'errors.lockNotExtended',
  7: 'errors.emptyWithdrawal',
  8: 'errors.lockTooFar',
  11: 'errors.unauthorized',
  12: 'errors.goalTooLarge',
  13: 'errors.generic',
  14: 'errors.invalidWeights',
  15: 'errors.priceMissing',
  16: 'errors.generic',
  17: 'errors.tooManyPockets',
  18: 'errors.invalidShares',
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const message = (e as { message: unknown }).message
    if (typeof message === 'string') return message
  }
  return 'Something went wrong'
}

export function errorKey(e: unknown): MessageKey {
  if (isMeraError(e)) {
    if (e.code === 'PRF_UNAVAILABLE' || e.code === 'CRYPTO_UNAVAILABLE') return 'errors.passkeyUnsupported'
    if (e.code === 'PASSKEY_OPERATION_FAILED') return 'errors.walletCancelled'
    if (e.code === 'DECRYPT_FAILED' || e.code === 'VAULT_FORMAT_INVALID') return 'errors.pocketDecrypt'
    return 'errors.generic'
  }
  const text = `${String(e)} ${errorMessage(e)}`
  const contract = /Error\(Contract, #(\d+)\)/.exec(text)
  if (contract) return CONTRACT_ERROR_KEYS[Number(contract[1])] ?? 'errors.generic'
  if (text.includes('faucet_busy')) return 'errors.faucetBusy'
  if (text.includes('faucet_unavailable') || text.includes('faucet_failed')) return 'errors.faucetUnavailable'
  if (text.includes('insufficient_ausd')) return 'errors.insufficientBalance'
  if (text.includes('wallet_not_connected')) return 'common.connectFirst'
  if (text.includes('wallet_passkey_mismatch')) return 'errors.passkeyMismatch'
  if (/INSUFFICIENT_FUNDS|insufficient funds|insufficient balance for transfer/i.test(text)) return 'errors.noGas'
  if (/NotAllowedError|reject|declin|denied|cancel/i.test(text)) return 'errors.walletCancelled'
  if (/CALL_EXCEPTION|execution reverted|transaction.*reverted/i.test(text)) return 'errors.txReverted'
  return 'errors.generic'
}
