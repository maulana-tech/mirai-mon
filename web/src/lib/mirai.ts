import { miraiEvm } from '@/lib/mirai.evm'
import { miraiMock } from '@/lib/mirai.mock'
import { CONTRACT_ID } from '@/lib/config'
import type { MiraiService } from '@/lib/types'

export const mirai: MiraiService = CONTRACT_ID === '' ? miraiMock : miraiEvm
