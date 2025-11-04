const RPC_ENDPOINT = 'https://api.prntscr.com/v1/'
const DEFAULT_BATCH_SIZE = 20

const boundFetch: typeof fetch = (input, init) => globalThis.fetch(input, init)

type JsonRpcPayload = {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, unknown>;
  id: number;
};

type LightshotScreenPayload = {
  id36: string;
  url: string;
  created_at?: string;
  [key: string]: unknown;
};

type LightshotResponse = {
  success?: boolean;
  result?: {
    success?: boolean;
    screens?: LightshotScreenPayload[];
    items?: LightshotScreenPayload[];
    next_id36?: string;
    next_cursor?: string;
    next_token?: string;
    next?: string;
    message?: string;
    data?: {
      screens?: LightshotScreenPayload[];
      items?: LightshotScreenPayload[];
      next_id36?: string;
      next_cursor?: string;
      next_token?: string;
      next?: string;
    };
  };
  error?: {
    message?: string;
    code?: number;
  };
  screens?: LightshotScreenPayload[];
  items?: LightshotScreenPayload[];
  next_id36?: string;
  next_cursor?: string;
  next_token?: string;
  next?: string;
};

export interface ScreenMeta {
  id36: string;
  url: string;
  date: string;
  thumb?: string,
  description?: string | null,
  share_url?: string | null,
}

export interface FetchScreensResult {
  screens: ScreenMeta[];
  nextCursor?: string;
}

export class LightshotClient {
  constructor(private readonly fetchImpl: typeof fetch = boundFetch) {}

  async fetchPage(cursor = '0', batchSize = DEFAULT_BATCH_SIZE, signal?: AbortSignal): Promise<FetchScreensResult> {
    const params: Record<string, unknown> = {
      count: batchSize,
      start_id36: cursor === '0' ? 0 : cursor,
    }

    const payload: JsonRpcPayload = {
      jsonrpc: '2.0',
      method: 'get_user_screens',
      params,
      id: Date.now(),
    }

    const response = await this.fetchImpl(RPC_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
        accept: 'application/json, text/javascript, */*; q=0.01',
      },
      body: JSON.stringify(payload),
      signal,
    })

    if (!response.ok) {
      throw new Error(`Lightshot API returned ${response.status}`)
    }

    const json = (await response.json()) as LightshotResponse

    const result = json.result ?? {}
    const candidateScreens =
      result.screens ??
      result.items ??
      result.data?.screens ??
      result.data?.items ??
      json.screens ??
      json.items ??
      []

    const success = result.success ?? json.success

    if (success === false && candidateScreens.length === 0) {
      return {
        screens: [],
        nextCursor: undefined,
      }
    }

    if (success === false) {
      const message =
        result.message ??
        json.error?.message ??
        'Unexpected Lightshot response'
      throw new Error(message)
    }

    const screens = candidateScreens.map<ScreenMeta>((screen) => ({
      id36: String(screen.id36),
      url: String(screen.url),
      date: typeof screen.date === 'string' ? screen.date : new Date().toLocaleDateString(),
    }))

    return {
      screens,
      nextCursor:
        result.next_id36 ??
        result.next_cursor ??
        result.next_token ??
        result.next ??
        result.data?.next_id36 ??
        result.data?.next_cursor ??
        result.data?.next_token ??
        result.data?.next ??
        json.next_id36 ??
        json.next_cursor ??
        json.next_token ??
        json.next,
    }
  }

  async getAllScreens(batchSize = DEFAULT_BATCH_SIZE, signal?: AbortSignal): Promise<ScreenMeta[]> {
    const allScreens: ScreenMeta[] = []
    let cursor = '0'

    while (!signal?.aborted) {
      const { screens, nextCursor } = await this.fetchPage(cursor, batchSize, signal)
      if (!screens.length) {
        break
      }

      allScreens.push(...screens)

      if (!nextCursor) {
        const last = screens[screens.length - 1]
        if (!last || last.id36 === cursor) {
          break
        }
        cursor = last.id36
        continue
      }

      if (nextCursor === cursor) {
        break
      }

      cursor = nextCursor
    }

    return allScreens
  }
}
