import { FingerprintIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { errorKey } from '@/lib/errors'
import { useT } from '@/lib/i18n'
import { requestTestFunds } from '@/lib/use-faucet'
import { useWallet } from '@/lib/wallet'

interface PasskeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Sign-in for Mirai: the account is derived from a passkey, so there is no wallet to pick. */
export function PasskeyDialog({ open, onOpenChange }: PasskeyDialogProps) {
  const t = useT()
  const { createAccount, signIn, connecting } = useWallet()

  const run = async (action: () => Promise<string>, isNew: boolean) => {
    let address: string
    try {
      address = await action()
      onOpenChange(false)
    } catch (e) {
      toast.error(t(errorKey(e)))
      return
    }
    // New accounts get gas + test AUSD in the background; the faucet page is the fallback.
    if (isNew) {
      requestTestFunds(address).then(
        () => toast.success(t('wallet.funded')),
        () => {},
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader className="mb-5 items-center text-center">
          <span className="mb-3 inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <FingerprintIcon className="size-6" />
          </span>
          <DialogTitle>{t('wallet.title')}</DialogTitle>
          <DialogDescription>{t('wallet.caption')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Button size="lg" disabled={connecting} onClick={() => void run(createAccount, true)}>
            {t('wallet.create')}
          </Button>
          <Button size="lg" variant="outline" disabled={connecting} onClick={() => void run(signIn, false)}>
            {t('wallet.signIn')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
