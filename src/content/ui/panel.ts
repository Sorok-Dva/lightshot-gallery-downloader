export interface DownloadRequest {
  concurrency: number
  sequential: boolean
  throttleMs: number
}

type DownloadHandler = (request: DownloadRequest) => void
type CancelHandler = () => void

const PANEL_ID = 'lgd-panel'
const BUTTON_ID = 'lgd-toggle-button'
const DEFAULT_CONCURRENCY = 4
const DEFAULT_THROTTLE_MS = 150
const MAX_THROTTLE_MS = 5000

export class DownloadPanel {
  private readonly root: HTMLDivElement
  private readonly statusEl: HTMLParagraphElement
  private readonly progressFill: HTMLSpanElement
  private readonly progressLabel: HTMLSpanElement
  private readonly logContainer: HTMLDivElement
  private readonly startButton: HTMLButtonElement
  private readonly cancelButton: HTMLButtonElement
  private readonly concurrencyInput: HTMLInputElement
  private readonly sequentialInput: HTMLInputElement
  private readonly throttleInput: HTMLInputElement
  private readonly creditsLink: HTMLAnchorElement

  private totalScreens = 0
  private completedScreens = 0
  private readonly downloadHandlers = new Set<DownloadHandler>()
  private readonly cancelHandlers = new Set<CancelHandler>()

  constructor() {
    this.root = this.createPanel()
    this.statusEl = this.root.querySelector('[data-lgd-status]') as HTMLParagraphElement
    this.progressFill = this.root.querySelector('[data-lgd-progress-bar]') as HTMLSpanElement
    this.progressLabel = this.root.querySelector('[data-lgd-progress-label]') as HTMLSpanElement
    this.logContainer = this.root.querySelector('[data-lgd-log]') as HTMLDivElement
    this.startButton = this.root.querySelector('button.lgd-start') as HTMLButtonElement
    this.cancelButton = this.root.querySelector('button.lgd-cancel') as HTMLButtonElement
    this.concurrencyInput = this.root.querySelector('input.lgd-concurrency') as HTMLInputElement
    this.sequentialInput = this.root.querySelector('input.lgd-sequential') as HTMLInputElement
    this.throttleInput = this.root.querySelector('input.lgd-throttle') as HTMLInputElement
    this.creditsLink = this.root.querySelector('[data-lgd-credits]') as HTMLAnchorElement

    this.initializeDefaults()
    this.bindEvents()
  }

  mount() {
    if (!document.body.contains(this.root)) {
      document.body.appendChild(this.root)
    }
  }

  attachToggleButton(targetNode: HTMLElement) {
    const existingButton = document.getElementById(BUTTON_ID)
    if (existingButton) {
      return existingButton as HTMLButtonElement
    }

    const button = document.createElement('button')
    button.id = BUTTON_ID
    button.type = 'button'
    button.textContent = 'Download gallery'
    button.className = [
      'lgd-inline-flex lgd-items-center lgd-gap-2 lgd-rounded-full lgd-bg-accent lgd-px-4 lgd-py-2',
      'lgd-text-sm lgd-font-semibold lgd-text-white lgd-shadow-md lgd-transition lgd-duration-150',
      'hover:lgd-bg-accentHover focus-visible:lgd-ring-2 focus-visible:lgd-ring-offset-2 focus-visible:lgd-ring-accent'
    ].join(' ')
    targetNode.appendChild(button)

    return button
  }

  show() {
    this.root.classList.remove('lgd-hidden')
    this.root.focus()
  }

  hide() {
    this.root.classList.add('lgd-hidden')
  }

  isVisible(): boolean {
    return !this.root.classList.contains('lgd-hidden')
  }

  onDownloadRequested(handler: DownloadHandler) {
    this.downloadHandlers.add(handler)
  }

  onCancel(handler: CancelHandler) {
    this.cancelHandlers.add(handler)
  }

  reset() {
    this.totalScreens = 0
    this.completedScreens = 0
    this.statusEl.textContent = 'Ready when you are.'
    this.progressFill.style.width = '0%'
    this.progressLabel.textContent = '0 / 0'
    this.logContainer.innerHTML = ''
    this.startButton.disabled = false
    this.cancelButton.disabled = true
    this.sequentialInput.disabled = false
    this.throttleInput.disabled = false
    this.updateConcurrencyDisabled(false)
    this.root.setAttribute('aria-busy', 'false')
  }

  setBusy(isBusy: boolean) {
    this.root.setAttribute('aria-busy', String(isBusy))
    this.startButton.disabled = isBusy
    this.cancelButton.disabled = !isBusy
    this.sequentialInput.disabled = isBusy
    this.throttleInput.disabled = isBusy
    this.updateConcurrencyDisabled(isBusy)
    this.startButton.classList.toggle('lgd-opacity-60', isBusy)
    this.startButton.classList.toggle('lgd-pointer-events-none', isBusy)
    this.cancelButton.classList.toggle('lgd-opacity-60', !isBusy)
    this.cancelButton.classList.toggle('lgd-pointer-events-none', !isBusy)
    const toggleButton = document.getElementById(BUTTON_ID) as HTMLButtonElement | null
    if (toggleButton) {
      toggleButton.disabled = isBusy
      toggleButton.classList.toggle('lgd-opacity-60', isBusy)
    }
  }

  setStatus(message: string) {
    this.statusEl.textContent = message
  }

  setStatusWithFailureHint({ completed, total, failed }: { completed: number; total: number; failed: number }) {
    const tooltipText = 'Lightshot or its storage provider could not serve these captures. They remain inaccessible on the server.'
    this.statusEl.innerHTML = `Downloading screenshots (${completed}/${total}) • ${failed} failed so far <small>${tooltipText}</small>`
  }

  requestDownload() {
    this.resetBeforeStart()
    const request = this.getDownloadRequest()
    this.downloadHandlers.forEach((handler) => handler(request))
  }

  setTotal(total: number) {
    this.totalScreens = total
    this.updateProgress(this.completedScreens)
  }

  updateProgress(completed: number) {
    this.completedScreens = completed
    const total = this.totalScreens > 0 ? this.totalScreens : Math.max(this.totalScreens, completed)
    const percent = total === 0 ? 0 : Math.min(100, Math.round((completed / total) * 100))
    this.progressFill.style.width = `${percent}%`
    this.progressLabel.textContent = `${completed} / ${total}`
  }

  pushLog(message: string, level: 'info' | 'warn' = 'info') {
    const entry = document.createElement('div')
    entry.className = [
      'lgd-text-xs lgd-leading-5',
      level === 'warn' ? 'lgd-text-danger' : 'lgd-text-slate-200'
    ].join(' ')
    entry.textContent = message
    entry.setAttribute('title', level === 'warn' && message.includes('account trouble')
      ? 'Lightshot/Backblaze returned an error for this screenshot. The original file is unavailable on their servers.'
      : '')
    this.logContainer.appendChild(entry)
    this.logContainer.scrollTop = this.logContainer.scrollHeight
  }

  showError(message: string) {
    this.setBusy(false)
    this.setStatus(`Error: ${message}`)
    this.pushLog(message, 'warn')
  }

  markDone(total: number, failed: number) {
    this.setBusy(false)
    this.setStatus(`All done! ${total} file(s) saved.${failed ? ` ${failed} failed (images not found on lightshot servers).` : ''}`)
  }

  private bindEvents() {
    this.startButton.addEventListener('click', () => {
      this.requestDownload()
    })

    this.cancelButton.addEventListener('click', () => {
      this.cancelHandlers.forEach((handler) => handler())
    })

    const closeButton = this.root.querySelector('button[data-lgd-close]') ?? this.root.querySelector('header button')
    if (closeButton) {
      closeButton.addEventListener('click', () => this.hide())
    }

    this.sequentialInput.addEventListener('change', () => {
      this.handleSequentialToggle()
    })

    this.throttleInput.addEventListener('change', () => {
      this.normalizeThrottleInput()
    })

    this.concurrencyInput.addEventListener('change', () => {
      this.normalizeConcurrencyInput()
    })

    this.creditsLink.addEventListener('click', (event) => {
      event.preventDefault()
      const url = chrome.runtime.getURL('credits/index.html')
      window.open(url, '_blank', 'noopener')
    })
  }

  private resetBeforeStart() {
    this.logContainer.innerHTML = ''
    this.completedScreens = 0
    this.progressFill.style.width = '0%'
    this.progressLabel.textContent = '0 / 0'
    this.setStatus('Preparing download...')
    this.setBusy(true)
  }

  private initializeDefaults() {
    this.concurrencyInput.value = String(DEFAULT_CONCURRENCY)
    this.throttleInput.value = String(DEFAULT_THROTTLE_MS)
    this.sequentialInput.checked = true
    this.normalizeConcurrencyInput()
    this.normalizeThrottleInput()
    this.handleSequentialToggle()
  }

  private handleSequentialToggle() {
    if (this.sequentialInput.checked && Number(this.throttleInput.value) <= 0) {
      this.throttleInput.value = String(DEFAULT_THROTTLE_MS)
    }
    this.normalizeThrottleInput()
    this.normalizeConcurrencyInput()
    this.updateConcurrencyDisabled(false)
  }

  private getDownloadRequest(): DownloadRequest {
    const sequential = this.sequentialInput.checked
    const concurrency = sequential ? 1 : this.getConcurrencyValue()
    const throttleMs = this.getThrottleValue()
    return { concurrency, sequential, throttleMs }
  }

  private getConcurrencyValue(): number {
    const value = Number(this.concurrencyInput.value)
    if (!Number.isFinite(value)) {
      return DEFAULT_CONCURRENCY
    }
    return Math.min(10, Math.max(1, Math.floor(value)))
  }

  private getThrottleValue(): number {
    const value = Number(this.throttleInput.value)
    if (!Number.isFinite(value) || value < 0) {
      return 0
    }
    return Math.min(Math.floor(value), MAX_THROTTLE_MS)
  }

  private normalizeThrottleInput() {
    this.throttleInput.value = String(this.getThrottleValue())
  }

  private normalizeConcurrencyInput() {
    this.concurrencyInput.value = String(this.getConcurrencyValue())
  }

  private updateConcurrencyDisabled(isBusy: boolean) {
    this.concurrencyInput.disabled = isBusy || this.sequentialInput.checked
    this.concurrencyInput.classList.toggle('lgd-opacity-50', this.concurrencyInput.disabled)
    this.concurrencyInput.classList.toggle('lgd-pointer-events-none', this.concurrencyInput.disabled)
  }

  private createPanel(): HTMLDivElement {
    const container = document.createElement('div')
    container.id = PANEL_ID
    container.tabIndex = -1
    container.setAttribute('role', 'dialog')
    container.setAttribute('aria-live', 'polite')
    container.setAttribute('aria-modal', 'false')
    container.className = [
      'lgd-fixed lgd-bottom-6 lgd-right-6 lgd-z-[2147483647] lgd-hidden',
      'lgd-w-[380px] lgd-max-w-[calc(100vw-32px)] lgd-rounded-3xl lgd-border lgd-border-outline',
      'lgd-bg-surface lgd-text-slate-100 lgd-backdrop-blur-2xl lgd-panel-shadow lgd-flex lgd-flex-col',
      'lgd-font-sans lgd-outline-none'
    ].join(' ')

    container.innerHTML = `
      <header class="lgd-flex lgd-items-center lgd-justify-between lgd-px-6 lgd-pt-6">
        <div class="lgd-flex lgd-flex-col lgd-gap-0.5">
          <span class="lgd-text-base lgd-font-semibold">Lightshot Gallery Downloader</span>
          <span class="lgd-text-xs lgd-text-slate-300">Batch your screenshots with confidence</span>
        </div>
        <button type="button" aria-label="Close panel" data-lgd-close class="lgd-text-slate-400 hover:lgd-text-slate-100 lgd-transition lgd-duration-150 lgd-text-2xl lgd-leading-none">×</button>
      </header>
      <div class="lgd-flex lgd-flex-col lgd-gap-5 lgd-px-6 lgd-pb-6 lgd-pt-3">
        <p data-lgd-status class="lgd-text-sm lgd-text-slate-200">Ready when you are.</p>
        <div class="lgd-flex lgd-flex-col lgd-gap-2">
          <div class="lgd-h-2 lgd-w-full lgd-rounded-full lgd-bg-surfaceAlt lgd-overflow-hidden">
            <span data-lgd-progress-bar class="lgd-block lgd-h-full lgd-w-0 lgd-bg-accent lgd-transition-all lgd-duration-300"></span>
          </div>
          <div class="lgd-flex lgd-items-center lgd-justify-between lgd-text-xs lgd-text-slate-300">
            <span>Progress</span>
            <span data-lgd-progress-label>0 / 0</span>
          </div>
        </div>
        <div data-lgd-log class="lgd-max-h-48 lgd-space-y-1.5 lgd-overflow-y-auto lgd-rounded-2xl lgd-bg-surfaceAlt lgd-p-4 lgd-text-xs lgd-leading-5 lgd-scrollbar"></div>
        <div class="lgd-grid lgd-grid-cols-1 lgd-gap-4">
          <label class="lgd-flex lgd-items-center lgd-justify-between lgd-gap-3 lgd-rounded-2xl lgd-border lgd-border-outline lgd-bg-surfaceAlt lgd-px-4 lgd-py-3 lgd-text-xs lgd-text-slate-300">
            <span class="lgd-flex lgd-flex-col lgd-gap-0.5">
              <span class="lgd-text-sm lgd-font-semibold lgd-text-slate-100">Sequential mode</span>
              <span>Slow but ultra-reliable</span>
            </span>
            <input type="checkbox" class="lgd-sequential lgd-h-5 lgd-w-5" checked />
          </label>
          <div class="lgd-grid lgd-grid-cols-2 lgd-gap-4">
            <label class="lgd-flex lgd-flex-col lgd-gap-1 lgd-text-xs lgd-text-slate-300">
              <span class="lgd-text-sm lgd-font-semibold lgd-text-slate-100">Throttle (ms)</span>
              <input type="number" min="0" max="${MAX_THROTTLE_MS}" value="${DEFAULT_THROTTLE_MS}" class="lgd-throttle lgd-rounded-xl lgd-border lgd-border-outline lgd-bg-surfaceAlt lgd-px-3 lgd-py-2 lgd-text-sm lgd-text-slate-100 focus:lgd-border-accent focus:lgd-outline-none" />
            </label>
            <label class="lgd-flex lgd-flex-col lgd-gap-1 lgd-text-xs lgd-text-slate-300">
              <span class="lgd-text-sm lgd-font-semibold lgd-text-slate-100">Concurrency</span>
              <input type="number" min="1" max="10" value="${DEFAULT_CONCURRENCY}" class="lgd-concurrency lgd-rounded-xl lgd-border lgd-border-outline lgd-bg-surfaceAlt lgd-px-3 lgd-py-2 lgd-text-sm lgd-text-slate-100 focus:lgd-border-accent focus:lgd-outline-none" />
            </label>
          </div>
        </div>
        <div class="lgd-flex lgd-items-center lgd-justify-between lgd-gap-3">
          <div class="lgd-flex lgd-gap-2">
            <button type="button" class="lgd-cancel lgd-inline-flex lgd-items-center lgd-justify-center lgd-rounded-xl lgd-border lgd-border-outline lgd-bg-surfaceAlt lgd-px-4 lgd-py-2 lgd-text-sm lgd-font-semibold lgd-text-slate-300 lgd-transition lgd-duration-150 hover:lgd-text-slate-100" disabled>Cancel</button>
            <button type="button" class="lgd-start lgd-inline-flex lgd-items-center lgd-justify-center lgd-rounded-xl lgd-bg-accent lgd-px-4 lgd-py-2 lgd-text-sm lgd-font-semibold lgd-text-white lgd-shadow-md lgd-transition lgd-duration-150 hover:lgd-bg-accentHover focus-visible:lgd-ring-2 focus-visible:lgd-ring-offset-2 focus-visible:lgd-ring-accent">Start</button>
          </div>
          <span class="lgd-text-xs lgd-font-medium lgd-text-accent hover:lgd-text-accentHover lgd-transition lgd-duration-150"><a href="#" data-lgd-credits>Credits:</a> Created by <a href="https://p-42.fr/sorokdva" target="_blank">Sorokdva</a>
        </div>
      </div>
    `

    return container
  }
}
