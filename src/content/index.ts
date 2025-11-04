import { DownloadPanel } from './ui/panel'
import { LightshotClient, ScreenMeta } from '../domain/lightshotClient'

type BackgroundMessage =
  | { type: 'start'; total: number; concurrency: number }
  | { type: 'progress'; total: number; completed: number; currentId: string; succeeded?: number; failed?: number }
  | { type: 'status'; message: string }
  | { type: 'log'; level: 'info' | 'warn'; message: string }
  | { type: 'done'; total: number; failed: number; processed?: number; succeeded?: number; downloadId?: number }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }

type BackgroundRequest =
  | { type: 'download'; concurrency: number; sequential: boolean; throttleMs: number; screens: ScreenMeta[] }
  | { type: 'cancel' }

declare global {
  interface HTMLElement {
    disabled?: boolean
  }
}

const panel = new DownloadPanel()
panel.mount()

const metadataClient = new LightshotClient()

let activePort: chrome.runtime.Port | null = null
let isDownloading = false
let metadataController: AbortController | null = null

const header = document.querySelector('h1.page-header__title') as HTMLElement | null
const toggleTarget = header ?? document.body
const toggleButton = panel.attachToggleButton(toggleTarget)

toggleButton.addEventListener('click', () => {
  panel.show()
  if (!isBusy()) {
    panel.requestDownload()
  }
})

panel.onDownloadRequested((request) => {
  if (isBusy()) {
    panel.pushLog('A download is already running.', 'warn')
    return
  }

  metadataController = new AbortController()
  const controller = metadataController
  isDownloading = true

  void (async () => {
    panel.pushLog('Collecting gallery metadata...')
    panel.setStatus('Collecting gallery metadata...')

    let screens: ScreenMeta[]

    try {
      screens = await metadataClient.getAllScreens(undefined, controller.signal)
    } catch (error) {
      if (controller.signal.aborted) {
        panel.pushLog('Metadata collection cancelled.', 'warn')
        panel.setStatus('Cancelled.')
      } else {
        const message = error instanceof Error ? error.message : String(error)
        panel.showError(message)
      }

      if (metadataController === controller) {
        metadataController = null
      }
      isDownloading = false
      panel.setBusy(false)
      return
    }

    if (metadataController === controller) {
      metadataController = null
    }

    if (!screens.length) {
      panel.pushLog('No screenshots found in your gallery.', 'warn')
      panel.setStatus('No screenshots found.')
      panel.markDone(0, 0)
      isDownloading = false
      return
    }

    const modeDescription = request.sequential
      ? `Sequential mode enabled (throttle ${request.throttleMs} ms).`
      : `Concurrent mode: ${request.concurrency} stream(s), throttle ${request.throttleMs} ms.`
    panel.pushLog(modeDescription)
    panel.setStatus('Connecting to background worker...')

    const port = chrome.runtime.connect({ name: 'lightshot-download' })
    activePort = port

    const cleanup = () => {
      if (activePort !== port) {
        return
      }

      isDownloading = false
      panel.setBusy(false)

      port.onMessage.removeListener(handleMessage)
      try {
        port.disconnect()
      } catch {
        // ignore
      }
      activePort = null
    }

    const handleMessage = (message: BackgroundMessage) => {
      switch (message.type) {
        case 'start':
          panel.setTotal(message.total)
          panel.pushLog(`Downloading ${message.total} file(s) with concurrency ${message.concurrency}.`)
          break
      case 'progress':
        {
          const completed = message.completed ?? 0
          const total = message.total ?? screens.length
          panel.updateProgress(completed)

          const failed = message.failed ?? 0
          if (failed > 0) {
            panel.setStatusWithFailureHint({ completed, total, failed })
          } else {
            panel.setStatus(`Downloading screenshots (${completed}/${total})`)
          }
        }
        break
        case 'status':
          panel.setStatus(message.message)
          panel.pushLog(message.message)
          break
        case 'log':
          panel.pushLog(message.message, message.level)
          break
      case 'done':
        {
          const processed = message.processed ?? message.total ?? 0
          const succeeded = message.succeeded ?? message.total ?? processed - (message.failed ?? 0)
          const failed = message.failed ?? 0
          panel.updateProgress(processed)
          panel.markDone(succeeded, failed)
          if (failed) {
            panel.pushLog(`${failed} screenshot(s) failed to download (missing on lightshot servers).`, 'warn')
          }
          panel.pushLog('Download started in Chrome. You can follow it in the Downloads panel.')
          
          cleanup()
        }
        break
        case 'error':
          panel.showError(message.message)
          cleanup()
          break
        case 'cancelled':
          panel.pushLog('Download cancelled.', 'warn')
          panel.setStatus('Cancelled.')
          panel.setBusy(false)
          cleanup()
          break
        default:
          break
      }
    }

    port.onMessage.addListener(handleMessage)
    port.onDisconnect.addListener(() => {
      if (activePort === port) {
        isDownloading = false
        panel.setBusy(false)
        activePort = null
      }
    })

    panel.setTotal(screens.length)
    port.postMessage({
      type: 'download',
      concurrency: request.concurrency,
      sequential: request.sequential,
      throttleMs: request.throttleMs,
      screens,
    } satisfies BackgroundRequest)
  })()
})

panel.onCancel(() => {
  if (metadataController) {
    panel.pushLog('Cancelling metadata collection...')
    metadataController.abort()
    metadataController = null
    isDownloading = false
    return
  }

  if (!activePort || !isDownloading) {
    return
  }

  panel.pushLog('Cancelling download...')
  activePort.postMessage({ type: 'cancel' } satisfies BackgroundRequest)
})

function isBusy(): boolean {
  return Boolean(metadataController) || Boolean(activePort)
}
