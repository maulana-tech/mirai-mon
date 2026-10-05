import { ChevronDownIcon, LogOutIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PasskeyDialog } from '@/components/passkey-dialog'
import { useT } from '@/lib/i18n'
import { useWallet } from '@/lib/wallet'

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`
}

export function ConnectButton({ className }: { className?: string }) {
  const t = useT()
  const { address, connecting, disconnect } = useWallet()
  const [pickerOpen, setPickerOpen] = useState(false)

  if (address) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="tabular-nums">
            {shortAddress(address)}
            <ChevronDownIcon className="ml-2 size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t('topbar.connected')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void disconnect()}>
            <LogOutIcon className="mr-2 size-4" />
            {t('topbar.disconnect')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <>
      <Button className={className} onClick={() => setPickerOpen(true)} disabled={connecting}>
        {connecting ? `${t('topbar.connecting')}...` : t('topbar.connect')}
      </Button>
      <PasskeyDialog open={pickerOpen} onOpenChange={setPickerOpen} />
    </>
  )
}
