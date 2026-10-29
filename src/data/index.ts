import type { DataRepository } from './types'
import { MemoryDataRepository } from './memory-adapter'
import { PocketBaseDataRepository } from './pocketbase-adapter'

const configuredAdapter = (
  import.meta.env.VITE_DATA_ADAPTER || 'memory'
).toLowerCase()

export const repository: DataRepository =
  configuredAdapter === 'pocketbase'
    ? new PocketBaseDataRepository()
    : new MemoryDataRepository()

export * from './types'
