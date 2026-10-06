// Pocket labels (name, icon, target) are private: encrypted with a key from the passkey's PRF, in a
// namespace separate from the account key, and only ciphertext goes on-chain.
//
// One PRF evaluation (one passkey prompt) per session unlocks every pocket: the output is turned into
// a non-extractable AES-256-GCM key via HKDF, and each label gets its own random 96-bit nonce. Mera's
// secret vault would cost a prompt per pocket (a fresh salt each), which doesn't scale to 10 pockets.
import { useEffect, useState } from 'react'
import { getPasskeyPrfOutput } from '@category-labs/mera'
import { getBytes, hexlify, sha256, toUtf8Bytes } from 'ethers'
import { currentCredential, onLock, rpId } from '@/lib/wallet'
import type { Pocket, PocketMeta } from '@/lib/types'

export type { PocketMeta }

const NAMESPACE = 'mirai.pockets.v1'
const VERSION = 1
const MAX_NAME = 40

let key: Promise<CryptoKey> | null = null
let unlocked = false
const listeners = new Set<() => void>()
const plain = new Map<string, PocketMeta>() // ciphertext hex -> label, for this session
const notify = () => listeners.forEach((l) => l())

onLock(() => {
  key = null
  unlocked = false
  plain.clear()
  notify()
})

/** One passkey prompt the first time per session; later calls reuse the key. */
function pocketKey(): Promise<CryptoKey> {
  key ??= (async () => {
    const { prfOutput } = await getPasskeyPrfOutput({
      rpId,
      credential: currentCredential(),
      prfSalt: getBytes(sha256(toUtf8Bytes(NAMESPACE))),
    })
    try {
      const ikm = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey'])
      return await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: new TextEncoder().encode(NAMESPACE) },
        ikm,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      )
    } finally {
      prfOutput.fill(0)
    }
  })().then(
    (k) => {
      unlocked = true
      notify()
      return k
    },
    (e: unknown) => {
      key = null // cancelled prompt: let the next call ask again
      throw e
    },
  )
  return key
}

/** Encrypts a label into on-chain bytes: version (1) || nonce (12) || AES-GCM ciphertext+tag. */
export async function encryptMeta(meta: PocketMeta): Promise<string> {
  const k = await pocketKey()
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const body = new TextEncoder().encode(
    JSON.stringify({ n: meta.name.trim().slice(0, MAX_NAME), e: meta.icon, t: meta.target.toString() }),
  )
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, body))
  const out = hexlify(new Uint8Array([VERSION, ...nonce, ...ct]))
  plain.set(out, { ...meta, name: meta.name.trim().slice(0, MAX_NAME) })
  return out
}

/** Decrypts on-chain bytes (untrusted input); null for an empty or unreadable label. */
async function decryptMeta(hex: string): Promise<PocketMeta | null> {
  const bytes = new Uint8Array(getBytes(hex))
  if (bytes.length < 13 + 16 || bytes[0] !== VERSION) return null
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(1, 13) }, await pocketKey(), bytes.slice(13))
    const p = JSON.parse(new TextDecoder().decode(pt)) as { n?: unknown; e?: unknown; t?: unknown }
    if (typeof p.n !== 'string' || typeof p.e !== 'string' || typeof p.t !== 'string') return null
    return { name: p.n.slice(0, MAX_NAME), icon: p.e.slice(0, 16), target: BigInt(p.t) }
  } catch {
    return null
  }
}

/**
 * Labels for the given pockets, by id. Decrypts automatically once the session key exists;
 * `unlock()` runs the one passkey prompt.
 */
export function usePocketMetas(pockets: Pocket[] | undefined) {
  const [, rerender] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const l = () => rerender((n) => n + 1)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  const encrypted = (pockets ?? []).filter((p) => p.meta !== '0x')
  const missing = unlocked ? encrypted.filter((p) => !plain.has(p.meta)) : []
  const missingKey = missing.map((p) => p.meta).join()
  useEffect(() => {
    if (!missingKey) return
    void Promise.all(
      missingKey.split(',').map(async (hex) => {
        const m = await decryptMeta(hex)
        if (m) plain.set(hex, m)
      }),
    ).then(notify)
  }, [missingKey])

  const metas: Record<number, PocketMeta | undefined> = {}
  for (const p of pockets ?? []) metas[p.id] = plain.get(p.meta)
  return {
    metas,
    /** Some pocket has a label that needs the passkey to show. */
    locked: !unlocked && encrypted.length > 0,
    busy,
    unlock: async () => {
      setBusy(true)
      try {
        await pocketKey()
      } finally {
        setBusy(false)
      }
    },
  }
}
