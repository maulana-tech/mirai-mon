import { useSyncExternalStore } from 'react'
import { HDNodeWallet, Mnemonic, getBytes } from 'ethers'
import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getPasskeyPrfOutput,
} from '@category-labs/mera'
import { readProvider } from '@/lib/config'
import { MeraSigner } from '@/lib/mera-signer'

// Standard Ethereum path, so the recovery phrase also opens the account in any wallet app.
const EVM_PATH = "m/44'/60'/0'/0/0"
const STORAGE_KEY = 'mirai:account:v1'
// Session design: everyday actions (pay, withdraw spending, split, goal) sign prompt-free for this
// long after a passkey ceremony. Actions that touch savings or can't be undone (withdraw savings,
// set a lock) ask for the passkey again even inside a session (`getSigner({ stepUp: true })`).
const SESSION_TTL_MS = 30 * 60 * 1000

type CachedAccount = { address: string; credentialId: string }

type WalletState = {
  status: 'none' | 'locked' | 'unlocked'
  address: string | null
  connecting: boolean
  /** When the prompt-free signing session ends (ms epoch); null while locked. */
  sessionEndsAt: number | null
}

export type WalletContextValue = WalletState & {
  createAccount: () => Promise<string>
  signIn: () => Promise<string>
  disconnect: () => void
  lock: () => void
}

const rpId = location.hostname

let signer: MeraSigner | null = null
let sessionTimer: ReturnType<typeof setTimeout> | undefined
let cached = loadCachedAccount()
let state: WalletState = {
  status: cached ? 'locked' : 'none',
  address: cached?.address ?? null,
  connecting: false,
  sessionEndsAt: null,
}
const listeners = new Set<() => void>()

function setState(next: Partial<WalletState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function loadCachedAccount(): CachedAccount | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CachedAccount>
    return typeof parsed.address === 'string' && typeof parsed.credentialId === 'string'
      ? { address: parsed.address, credentialId: parsed.credentialId }
      : null
  } catch {
    return null
  }
}

function saveCachedAccount(account: CachedAccount | null) {
  cached = account
  try {
    if (account) localStorage.setItem(STORAGE_KEY, JSON.stringify(account))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // storage unavailable (private mode); the passkey still restores the account
  }
}

/** PRF output -> BIP-39 phrase -> account key -> Mera signing session. Zeroes the PRF output. */
function signerFromPrf(prfOutput: Uint8Array): MeraSigner {
  try {
    const node = HDNodeWallet.fromMnemonic(Mnemonic.fromEntropy(prfOutput), EVM_PATH)
    const privateKey = getBytes(node.privateKey)
    try {
      return new MeraSigner(createSecp256k1SigningSession({ privateKey }), readProvider)
    } finally {
      privateKey.fill(0)
    }
  } finally {
    prfOutput.fill(0)
  }
}

const lockHooks = new Set<() => void>()
/** Runs `fn` whenever the session ends, so other in-memory secrets (pocket labels) go with the key. */
export function onLock(fn: () => void) {
  lockHooks.add(fn)
}

/** Ends the signing session now; the key is zeroed and the next write asks for the passkey. */
export function lock() {
  lockHooks.forEach((fn) => fn())
  clearTimeout(sessionTimer)
  signer?.end()
  signer = null
  if (state.status === 'unlocked') setState({ status: 'locked', sessionEndsAt: null })
}

function startSession(next: MeraSigner, credentialId: string): string {
  // a fresh ceremony replaces the signer without ending the session's other secrets
  clearTimeout(sessionTimer)
  signer?.end()
  signer = next
  saveCachedAccount({ address: next.address, credentialId })
  sessionTimer = setTimeout(lock, SESSION_TTL_MS)
  setState({ status: 'unlocked', address: next.address, sessionEndsAt: Date.now() + SESSION_TTL_MS })
  return next.address
}

async function withConnecting<T>(fn: () => Promise<T>): Promise<T> {
  setState({ connecting: true })
  try {
    return await fn()
  } finally {
    setState({ connecting: false })
  }
}

export function createAccount(): Promise<string> {
  return withConnecting(async () => {
    const created = await createPasskeyWithPrfOutput({
      rp: { id: rpId, name: 'Mirai' },
      user: { name: 'Mirai', displayName: `Mirai ${new Date().toLocaleDateString()}` },
    })
    return startSession(signerFromPrf(created.prfOutput), created.credentialId)
  })
}

/** Restores the account from any synced passkey; works on a fresh device or after storage is cleared. */
export function signIn(): Promise<string> {
  return withConnecting(async () => {
    const { prfOutput, credentialId } = await getPasskeyPrfOutput({ rpId })
    return startSession(signerFromPrf(prfOutput), credentialId)
  })
}

export function disconnect() {
  lock()
  saveCachedAccount(null)
  setState({ status: 'none', address: null })
}

/**
 * Signer for write paths. A locked account runs one passkey ceremony to restart the session;
 * `stepUp` always runs one, so sensitive actions are confirmed by the passkey holder in person.
 */
export async function getSigner({ stepUp = false }: { stepUp?: boolean } = {}): Promise<MeraSigner> {
  if (signer && !stepUp) return signer
  if (!cached) throw new Error('wallet_not_connected')
  const account = cached
  await withConnecting(async () => {
    const { prfOutput, credentialId } = await getPasskeyPrfOutput({
      rpId,
      credential: { credentialId: account.credentialId },
    })
    const next = signerFromPrf(prfOutput)
    if (next.address !== account.address) {
      next.end()
      throw new Error('wallet_passkey_mismatch')
    }
    startSession(next, credentialId)
  })
  return signer!
}

/** The passkey credential behind the current account; other PRF namespaces are evaluated on it. */
export function currentCredential(): { credentialId: string } {
  if (!cached) throw new Error('wallet_not_connected')
  return { credentialId: cached.credentialId }
}

export { rpId }

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useWallet(): WalletContextValue {
  const snapshot = useSyncExternalStore(subscribe, () => state)
  return { ...snapshot, createAccount, signIn, disconnect, lock }
}
