// Private savings goal: encrypted with a passkey PRF namespace separate from the account key.
//
// Mera's secret vault draws a fresh random PRF salt per vault and derives an AES-256-GCM key via
// HKDF (`mera.v1.encrypt.secret`), so the goal key is unrelated to the signing key and nothing
// secret is ever stored. Only the vault (salt, nonce, ciphertext) goes on-chain; the same synced
// passkey re-derives the key on any device.
import {
  createSecretVaultWithExistingPasskey,
  decryptSecretVaultWithPasskey,
  parseSecretVault,
} from '@category-labs/mera'
import { currentCredential, rpId } from '@/lib/wallet'

export type SavingsGoal = {
  name: string
  /** Target in AUSD base units. */
  target: bigint
}

const MAX_NAME = 60

/** One passkey prompt: encrypts the goal into a vault (JSON) ready to store on-chain. */
export async function encryptGoal(goal: SavingsGoal): Promise<string> {
  const secret = new TextEncoder().encode(
    JSON.stringify({ name: goal.name.trim().slice(0, MAX_NAME), target: goal.target.toString() }),
  )
  try {
    const vault = await createSecretVaultWithExistingPasskey({ rpId, credential: currentCredential(), secret })
    return JSON.stringify(vault)
  } finally {
    secret.fill(0)
  }
}

/** One passkey prompt: decrypts a vault read from chain. The vault is untrusted input. */
export async function decryptGoal(encrypted: string): Promise<SavingsGoal> {
  const vault = parseSecretVault(encrypted)
  const bytes = await decryptSecretVaultWithPasskey({ rpId, vault })
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { name?: unknown; target?: unknown }
    if (typeof parsed.name !== 'string' || typeof parsed.target !== 'string') throw new Error('goal_format')
    return { name: parsed.name.slice(0, MAX_NAME), target: BigInt(parsed.target) }
  } finally {
    bytes.fill(0)
  }
}
