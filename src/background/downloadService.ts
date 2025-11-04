import JSZip from 'jszip'
import { LightshotClient, ScreenMeta } from '../domain/lightshotClient'
import { createThrottler } from '../shared/throttler'

interface DownloadOptions {
  concurrency: number;
  signal: AbortSignal;
  port: chrome.runtime.Port;
  retryAttempts: number;
  retryBaseDelayMs: number;
  throttleDelayMs: number;
  screens?: ScreenMeta[];
}

interface ProgressPayload {
  type: 'progress';
  completed: number;
  total: number;
  currentId: string;
  succeeded?: number;
  failed?: number;
}

interface LogPayload {
  type: 'log';
  level: 'info' | 'warn';
  message: string;
}

interface StatusPayload {
  type: 'status';
  message: string;
}

interface StartPayload {
  type: 'start';
  total: number;
  concurrency: number;
}

interface DonePayload {
  type: 'done';
  total: number;
  failed: number;
  downloadId?: number;
  processed?: number;
  succeeded?: number;
}

interface ErrorPayload {
  type: 'error';
  message: string;
}

interface CancelledPayload {
  type: 'cancelled';
}

type PortMessage =
  | ProgressPayload
  | LogPayload
  | StatusPayload
  | StartPayload
  | DonePayload
  | ErrorPayload
  | CancelledPayload;

const DEFAULT_FILENAME = 'lightshot-gallery.zip'
const LARGE_GALLERY_THRESHOLD = 800
const MIN_SEQUENTIAL_THROTTLE_MS = 150
const boundFetch: typeof fetch = (input, init) => globalThis.fetch(input, init)

class NonRetryableError extends Error {
  retryable = false
}

export class DownloadService {
  constructor(private readonly client = new LightshotClient()) {}

  private send(port: chrome.runtime.Port, payload: PortMessage) {
    port.postMessage(payload)
  }

  async run({ concurrency, signal, port, retryAttempts, retryBaseDelayMs, throttleDelayMs, screens }: DownloadOptions): Promise<void> {
    try {
      let resolvedScreens = screens ?? null

      if (!resolvedScreens) {
        this.send(port, { type: 'status', message: 'Collecting gallery metadata...' })
        resolvedScreens = await this.client.getAllScreens(undefined, signal)
      }

      if (!resolvedScreens || !resolvedScreens.length) {
        this.send(port, { type: 'status', message: 'No screenshots found in your gallery.' })
        this.send(port, { type: 'done', total: 0, failed: 0 })
        return
      }

      let effectiveConcurrency = concurrency
      let effectiveThrottle = throttleDelayMs

      if (resolvedScreens.length >= LARGE_GALLERY_THRESHOLD && concurrency > 1) {
        effectiveConcurrency = 1
        effectiveThrottle = Math.max(throttleDelayMs, MIN_SEQUENTIAL_THROTTLE_MS)
        this.send(port, {
          type: 'status',
          message: `Large gallery detected (${resolvedScreens.length} screenshots). Switching to sequential mode for stability.`,
        })
      }

      if (effectiveThrottle > 0) {
        this.send(port, {
          type: 'log',
          level: 'info',
          message: `Throttle delay set to ${effectiveThrottle} ms between downloads.`,
        })
      }

      this.send(port, { type: 'start', total: resolvedScreens.length, concurrency: effectiveConcurrency })
      await this.downloadScreens(resolvedScreens, {
        concurrency: effectiveConcurrency,
        signal,
        port,
        retryAttempts,
        retryBaseDelayMs,
        throttleDelayMs: effectiveThrottle,
      })
    } catch (error) {
      if (signal.aborted) {
        this.send(port, { type: 'status', message: 'Download cancelled.' })
        this.send(port, { type: 'cancelled' })
        return
      }

      const message = error instanceof Error ? error.message : String(error)
      this.send(port, { type: 'error', message })
    }
  }

  private async downloadScreens(
    screens: ScreenMeta[],
    {
      concurrency,
      signal,
      port,
      retryAttempts,
      retryBaseDelayMs,
      throttleDelayMs,
    }: Omit<DownloadOptions, 'port'> & { port: chrome.runtime.Port }
  ): Promise<void> {
    const zip = new JSZip()
    const throttler = createThrottler(concurrency)
    let processed = 0
    let succeeded = 0
    let failed = 0

    this.send(port, { type: 'status', message: `Downloading ${screens.length} screenshot(s)...` })

    const emitProgress = (currentId: string) => {
      this.send(port, {
        type: 'progress',
        completed: processed,
        total: screens.length,
        currentId,
        succeeded,
        failed,
      })
    }

    await Promise.all(
      screens.map((screen) =>
        throttler(async () => {
          signal.throwIfAborted()

          const success = await this.downloadWithRetry({
            screen,
            zip,
            signal,
            retryAttempts,
            retryBaseDelayMs,
            throttleDelayMs,
            port,
          })

          if (success) {
            succeeded += 1
            processed += 1
            emitProgress(screen.id36)
          } else {
            failed += 1
            processed += 1
            this.send(port, {
              type: 'log',
              level: 'warn',
              message: `Giving up on ${screen.id36} after ${retryAttempts} attempts.`,
            })
            emitProgress(screen.id36)
          }
        })
      )
    )

    signal.throwIfAborted()
    this.send(port, { type: 'status', message: 'Packaging ZIP archive...' })

    const archiveBytes = await zip.generateAsync({ type: 'uint8array' })
    const dataUrl = `data:application/zip;base64,${encodeToBase64(archiveBytes)}`

    try {
      const downloadId = await this.triggerDownload(dataUrl)
      this.send(port, {
        type: 'done',
        total: succeeded,
        processed,
        succeeded,
        failed,
        downloadId: downloadId ?? undefined,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.send(port, { type: 'error', message })
    }
  }

  private async triggerDownload(url: string): Promise<number | undefined> {
    return new Promise((resolve, reject) => {
      chrome.downloads.download(
        {
          url,
          filename: DEFAULT_FILENAME,
          saveAs: true,
        },
        (downloadId) => {
          const error = chrome.runtime.lastError
          if (error) {
            reject(new Error(error.message))
            return
          }
          resolve(downloadId ?? undefined)
        }
      )
    })
  }

  private async downloadWithRetry({
    screen,
    zip,
    signal,
    retryAttempts,
    retryBaseDelayMs,
    throttleDelayMs,
    port,
  }: {
    screen: ScreenMeta;
    zip: JSZip;
    signal: AbortSignal;
    retryAttempts: number;
    retryBaseDelayMs: number;
    throttleDelayMs: number;
    port: chrome.runtime.Port;
  }): Promise<boolean> {
    for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
      try {
        signal.throwIfAborted()

        const response = await boundFetch(screen.url, {
          signal,
          credentials: 'include'
        })

        if (!response.ok) {
          if (response.status === 403) {
            let details: unknown
            try {
              details = await response.clone().json()
            } catch {
              // ignore JSON parse errors
            }

            const code = typeof details === 'object' && details ? (details as { code?: unknown }).code : undefined
            if (code === 'account_trouble') {
              throw new NonRetryableError(
                `Lightshot cannot serve ${screen.id36}: upstream returned account trouble (image missing on server).`
              )
            }
          }

          throw new Error(`Failed to fetch ${screen.id36} (${response.status})`)
        }

        const buffer = await response.arrayBuffer()
        const fileOptions: JSZip.JSZipFileOptions = {}
        const parsedDate = parseLightshotDate(screen.date)
        if (parsedDate) {
          fileOptions.date = parsedDate
        }

        zip.file(`screenshot_${screen.id36}.png`, buffer, fileOptions)

        if (throttleDelayMs > 0) {
          await delay(throttleDelayMs, signal)
        }

        return true
      } catch (error) {
        if (signal.aborted) {
          throw error
        }

        const nonRetryable = error instanceof NonRetryableError || (error as { retryable?: boolean }).retryable === false

        if (attempt < retryAttempts && !nonRetryable) {
          const backoffTime = retryBaseDelayMs * Math.pow(2, attempt - 1)
          const message = error instanceof Error ? error.message : String(error)
          this.send(port, {
            type: 'log',
            level: 'warn',
            message: `Retry ${attempt}/${retryAttempts} for ${screen.id36}: ${message}`,
          })
          await delay(backoffTime, signal)
        } else {
          const message = error instanceof Error ? error.message : String(error)
          this.send(port, {
            type: 'log',
            level: 'warn',
            message: `Final failure for ${screen.id36}: ${message}`,
          })
          return false
        }
      }
    }

    return false
  }
}

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) {
      resolve()
      return
    }

    let settled = false
    let timer: ReturnType<typeof setTimeout>
    const onAbort = () => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }

    timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    signal.addEventListener('abort', onAbort, { once: true })
  })

const encodeToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

const parseLightshotDate = (value?: string): Date | undefined => {
  if (!value) {
    return undefined
  }

  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed
  }

  return undefined
}
