import { DownloadService } from './downloadService'
import { ScreenMeta } from '../domain/lightshotClient'

const downloadService = new DownloadService()

const DEFAULT_CONCURRENCY = 4
const DEFAULT_RETRY_ATTEMPTS = 3
const DEFAULT_RETRY_BASE_DELAY_MS = 500
const DEFAULT_SEQUENTIAL_THROTTLE_MS = 150
const MAX_THROTTLE_MS = 5000

type DownloadMessage = {
  concurrency?: unknown
  sequential?: unknown
  throttleMs?: unknown
  screens?: ScreenMeta[]
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'lightshot-download') {
    return
  }

  let controller: AbortController | null = null
  let activeTask: Promise<void> | null = null

  const cleanup = () => {
    controller = null
    activeTask = null
  }

  const startDownload = (options?: DownloadMessage) => {
    if (activeTask) {
      port.postMessage({ type: 'error', message: 'A download is already running.' })
      return
    }

    const isSequential = Boolean(options?.sequential)
    const normalizedConcurrency = normalizeConcurrency(options?.concurrency)
    const concurrency = isSequential ? 1 : normalizedConcurrency
    const throttleMs = normalizeThrottle(options?.throttleMs)
    const throttleDelayMs = concurrency === 1 ? Math.max(throttleMs, DEFAULT_SEQUENTIAL_THROTTLE_MS) : throttleMs

    controller = new AbortController()

    activeTask = downloadService
      .run({
        concurrency,
        signal: controller.signal,
        port,
        retryAttempts: DEFAULT_RETRY_ATTEMPTS,
        retryBaseDelayMs: DEFAULT_RETRY_BASE_DELAY_MS,
        throttleDelayMs,
        screens: options?.screens,
      })
      .catch((error) => {
        if (controller?.signal.aborted) {
          return
        }

        const message = error instanceof Error ? error.message : String(error)
        port.postMessage({ type: 'error', message })
      })
      .finally(() => {
        cleanup()
      })
  }

  const cancelDownload = () => {
    if (!controller) {
      return
    }
    controller.abort()
  }

  port.onMessage.addListener((message) => {
    switch (message?.type) {
      case 'download':
        startDownload(message)
        break
      case 'cancel':
        cancelDownload()
        break
      default:
        break
    }
  })

  port.onDisconnect.addListener(() => {
    cancelDownload()
  })
})

const normalizeConcurrency = (value: unknown): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CONCURRENCY
  }

  return Math.min(10, Math.max(1, Math.floor(parsed)))
}

const normalizeThrottle = (value: unknown): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0
  }

  return Math.min(Math.floor(parsed), MAX_THROTTLE_MS)
}

const openCreditsPage = async () => {
  const url = chrome.runtime.getURL('credits/index.html')
  await chrome.tabs.create({ url })
}

chrome.action.onClicked.addListener(() => {
  openCreditsPage().catch((error) => {
    console.error('Failed to open credits page', error)
  })
})

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    openCreditsPage().catch(() => {
      // Ignore initial open failure (e.g., blocked pop-up)
    })
  }
})
