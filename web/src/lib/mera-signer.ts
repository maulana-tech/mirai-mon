import {
  AbstractSigner,
  Signature,
  Transaction,
  TypedDataEncoder,
  copyRequest,
  getAddress,
  getBytes,
  hashMessage,
  hexlify,
  resolveAddress,
  type Provider,
  type TransactionLike,
  type TransactionRequest,
  type TransactionResponse,
  type TypedDataDomain,
  type TypedDataField,
} from 'ethers'
import { getEvmAddress, type Secp256k1SigningSession } from '@category-labs/mera'

// Monad charges the full gas limit, so pad estimates only slightly.
const GAS_BUFFER_PCT = 110n

/**
 * ethers signer backed by a Mera signing session. The private key lives inside the session and
 * every signature is a local digest signature, so signing never shows a passkey prompt.
 */
export class MeraSigner extends AbstractSigner {
  readonly address: string
  readonly #session: Secp256k1SigningSession
  // Monad's RPC can report a stale pending nonce right after a receipt (async execution), so the
  // next nonce is also tracked locally from what this signer broadcast.
  #nextNonce: number | null = null

  constructor(session: Secp256k1SigningSession, provider: Provider) {
    super(provider)
    this.#session = session
    this.address = getAddress(getEvmAddress(session.publicKey))
  }

  async getAddress(): Promise<string> {
    return this.address
  }

  connect(provider: Provider | null): MeraSigner {
    if (!provider) throw new Error('MeraSigner needs a provider')
    return new MeraSigner(this.#session, provider)
  }

  async #sign(digest: string): Promise<Signature> {
    const { compact, recovery } = await this.#session.signDigest(getBytes(digest))
    return Signature.from({
      r: hexlify(compact.slice(0, 32)),
      s: hexlify(compact.slice(32, 64)),
      yParity: recovery,
    })
  }

  async populateTransaction(tx: TransactionRequest): Promise<TransactionLike<string>> {
    if (tx.nonce == null && this.#nextNonce !== null) {
      const chainNonce = await this.provider!.getTransactionCount(this.address, 'pending')
      tx = { ...tx, nonce: Math.max(chainNonce, this.#nextNonce) }
    }
    const populated = await super.populateTransaction(tx)
    if (tx.gasLimit == null && populated.gasLimit != null) {
      populated.gasLimit = (BigInt(populated.gasLimit) * GAS_BUFFER_PCT) / 100n
    }
    return populated
  }

  async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    const sent = await super.sendTransaction(tx)
    this.#nextNonce = sent.nonce + 1
    return sent
  }

  // Mirrors ethers' BaseWallet. copyRequest matters: sendTransaction passes a Transaction instance,
  // whose fields are getters that object spread would silently drop.
  async signTransaction(request: TransactionRequest): Promise<string> {
    const req = copyRequest(request)
    if (req.from != null) {
      if (getAddress(await resolveAddress(req.from, this)) !== this.address) {
        throw new Error('transaction from address mismatch')
      }
      delete req.from
    }
    if (req.to != null) req.to = await resolveAddress(req.to, this)
    const tx = Transaction.from(req as TransactionLike<string>)
    tx.signature = await this.#sign(tx.unsignedHash)
    return tx.serialized
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    return (await this.#sign(hashMessage(message))).serialized
  }

  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string> {
    return (await this.#sign(TypedDataEncoder.hash(domain, types, value))).serialized
  }

  end(): void {
    this.#session.end()
  }
}
