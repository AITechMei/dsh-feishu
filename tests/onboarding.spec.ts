import { describe, expect, it, vi } from 'vitest'
import {
  regInit,
  regBegin,
  regPoll,
  probeBot,
  qrRegister,
  renderQr,
  REGISTRATION_PATH,
  SCAN_URL_ATTRIBUTION,
  type FetchImpl,
  type FetchResponse,
} from '../src/onboarding.ts'

/** Build a FetchImpl stub returning the given response for the `poll` action
 *  and throwing for unexpected bodies. Successive responses may be queued. */
function fetchStub(handler: (url: string, body: Record<string, string>, n: number) => unknown): FetchImpl {
  let n = 0
  return async (_url, init) => {
    const body: Record<string, string> = {}
    for (const [k, v] of new URLSearchParams(init?.body ?? '').entries()) body[k] = v
    const payload = handler(_url, body, n++)
    return { status: 200, json: async () => payload } as FetchResponse
  }
}

function ok(data: unknown): FetchImpl {
  return fetchStub((_u, _b) => data)
}

describe('regInit', () => {
  it('accepts a client_secret-capable registration environment', async () => {
    const fetch = ok({ supported_auth_methods: ['client_secret', 'other'] })
    await expect(regInit('feishu', fetch)).resolves.toBeUndefined()
  })

  it('throws when client_secret auth is unsupported', async () => {
    const fetch = ok({ supported_auth_methods: ['only_other'] })
    await expect(regInit('feishu', fetch)).rejects.toThrow(/does not support client_secret/)
  })

  it('requests the feishu registration endpoint for the domain', async () => {
    let url = ''
    const fetch = fetchStub((u, body) => {
      url = u
      expect(body.action).toBe('init')
      return { supported_auth_methods: ['client_secret'] }
    })
    await regInit('feishu', fetch)
    expect(url).toBe(`https://accounts.feishu.cn${REGISTRATION_PATH}`)
  })
})

describe('regBegin', () => {
  it('sends the PersonalAgent begin payload and returns poll metadata', async () => {
    const seen: Record<string, string>[] = []
    const fetch = fetchStub((_u, body) => {
      seen.push(body)
      return {
        device_code: 'dev-1',
        verification_uri_complete: 'https://qr/scan?q=abc',
        user_code: '1234',
        interval: 4,
        expire_in: 300,
      }
    })
    const result = await regBegin('lark', fetch)
    expect(seen[0]).toEqual({
      action: 'begin',
      archetype: 'PersonalAgent',
      auth_method: 'client_secret',
      request_user_info: 'open_id',
    })
    expect(result.deviceCode).toBe('dev-1')
    expect(result.qrUrl).toBe(`https://qr/scan?q=abc&${SCAN_URL_ATTRIBUTION}`)
    expect(result.userCode).toBe('1234')
    expect(result.interval).toBe(4)
    expect(result.expireIn).toBe(300)
  })

  it('appends attribution even when the URL has no query', async () => {
    const fetch = ok({ device_code: 'd', verification_uri_complete: 'https://qr/scan' })
    const result = await regBegin('feishu', fetch)
    expect(result.qrUrl).toBe(`https://qr/scan?${SCAN_URL_ATTRIBUTION}`)
  })

  it('defaults interval/expire when omitted', async () => {
    const fetch = ok({ device_code: 'd', verification_uri_complete: 'https://qr' })
    const result = await regBegin('feishu', fetch)
    expect(result.interval).toBe(5)
    expect(result.expireIn).toBe(600)
  })

  it('throws when no device_code is returned', async () => {
    const fetch = ok({})
    await expect(regBegin('feishu', fetch)).rejects.toThrow(/did not return a device_code/)
  })

  it('throws when no verification_uri_complete is returned', async () => {
    const fetch = ok({ device_code: 'd' })
    await expect(regBegin('feishu', fetch)).rejects.toThrow(/did not return a verification_uri_complete/)
  })
})

describe('regPoll', () => {
  it('returns credentials after the user scans', async () => {
    const fetch = fetchStub((_u, body, n) => {
      expect(body.action).toBe('poll')
      expect(body.device_code).toBe('dev-1')
      expect(body.tp).toBe('ob_app')
      return n === 0
        ? { error: 'authorization_pending' }
        : { client_id: 'cli_x', client_secret: 'sec', user_info: { open_id: 'ou_1' } }
    })
    const result = await regPoll({
      deviceCode: 'dev-1',
      interval: 1,
      expireIn: 600,
      initialRegion: 'feishu',
      clock: () => 0,
      sleep: async () => {},
      fetchImpl: fetch,
    })
    expect(result).toEqual({ appId: 'cli_x', appSecret: 'sec', domain: 'feishu', openId: 'ou_1' })
  })

  it('auto-switches to lark when the tenant brand is lark', async () => {
    const fetch = fetchStub((_u, _b, n) => {
      if (n === 0) return { user_info: { tenant_brand: 'lark' }, error: 'authorization_pending' }
      return { client_id: 'cli_x', client_secret: 'sec', user_info: { open_id: 'ou_1' } }
    })
    const result = await regPoll({
      deviceCode: 'dev-1',
      interval: 1,
      expireIn: 600,
      initialRegion: 'feishu',
      clock: () => 0,
      sleep: async () => {},
      fetchImpl: fetch,
    })
    expect(result?.domain).toBe('lark')
  })

  it('returns undefined on access_denied', async () => {
    const fetch = fetchStub((_u, _b) => ({ error: 'access_denied' }))
    const result = await regPoll({
      deviceCode: 'd',
      interval: 1,
      expireIn: 600,
      clock: () => 0,
      sleep: async () => {},
      fetchImpl: fetch,
    })
    expect(result).toBeUndefined()
  })

  it('returns undefined on expired_token', async () => {
    const fetch = fetchStub((_u, _b) => ({ error: 'expired_token' }))
    const result = await regPoll({
      deviceCode: 'd',
      interval: 1,
      expireIn: 600,
      clock: () => 0,
      sleep: async () => {},
      fetchImpl: fetch,
    })
    expect(result).toBeUndefined()
  })

  it('does not treat empty-string credentials as success', async () => {
    const fetch = fetchStub((_u, _b) => ({ client_id: '', client_secret: '' }))
    const result = await regPoll({
      deviceCode: 'd',
      interval: 1,
      expireIn: 0,
      clock: () => 0,
      sleep: async () => {},
      fetchImpl: fetch,
    })
    expect(result).toBeUndefined()
  })

  it('times out and returns undefined while still pending', async () => {
    let now = 0
    const fetch = fetchStub((_u, _b) => ({ error: 'authorization_pending' }))
    const result = await regPoll({
      deviceCode: 'd',
      interval: 1,
      expireIn: 10,
      initialRegion: 'feishu',
      clock: () => now,
      sleep: async () => { now += 5000 },
      fetchImpl: fetch,
    })
    expect(result).toBeUndefined()
  })
})

describe('probeBot', () => {
  it('returns bot identity from the client probe', async () => {
    const createClient = () => ({
      request: async () => ({ code: 0, bot: { app_name: 'My Bot', open_id: 'ou_bot' } }),
    })
    const result = await probeBot('a', 's', 'feishu', createClient)
    expect(result).toEqual({ botName: 'My Bot', botOpenId: 'ou_bot' })
  })

  it('returns undefined on a non-zero code', async () => {
    const createClient = () => ({ request: async () => ({ code: 999 }) })
    expect(await probeBot('a', 's', 'feishu', createClient)).toBeUndefined()
  })

  it('returns undefined when probing throws', async () => {
    const createClient = () => ({ request: async () => { throw new Error('boom') } })
    expect(await probeBot('a', 's', 'feishu', createClient)).toBeUndefined()
  })
})

describe('renderQr', () => {
  it('returns true when a terminal QR can be produced', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as never)
    await expect(renderQr('https://qr/x')).resolves.toBe(true)
    write.mockRestore()
  })
})

describe('qrRegister', () => {
  it('walks init->begin->poll->probe and returns the onboarded account', async () => {
    const fetch = fetchStub((url, body, n) => {
      if (body.action === 'init') return { supported_auth_methods: ['client_secret'] }
      if (body.action === 'begin') {
        return { device_code: 'dev', verification_uri_complete: 'https://qr', interval: 1, expire_in: 600 }
      }
      // poll: first poll pending, second resolves with credentials
      return n === 2
        ? { error: 'authorization_pending' }
        : { client_id: 'cli_x', client_secret: 'sec', user_info: { open_id: 'ou_1' } }
    })
    const printed: string[] = []
    const renderQrImpl = async () => false
    const result = await qrRegister({
      initialRegion: 'feishu',
      timeoutSeconds: 60,
      fetchImpl: fetch,
      renderQrImpl,
      print: (line) => printed.push(line),
    })
    expect(result).toEqual({
      appId: 'cli_x',
      appSecret: 'sec',
      domain: 'feishu',
      openId: 'ou_1',
      botName: undefined,
      botOpenId: undefined,
    })
    expect(printed.some((l) => l.includes('https://qr'))).toBe(true)
  })

  it('returns undefined when polling fails', async () => {
    const fetch = fetchStub((_u, body) => {
      if (body.action === 'init') return { supported_auth_methods: ['client_secret'] }
      if (body.action === 'begin') return { device_code: 'dev', verification_uri_complete: 'https://qr' }
      return { error: 'access_denied' }
    })
    const result = await qrRegister({
      fetchImpl: fetch,
      renderQrImpl: async () => false,
      print: () => {},
    })
    expect(result).toBeUndefined()
  })

  it('degrades to undefined when the registration network call rejects', async () => {
    const fetch = async () => { throw new Error('network down') }
    const printed: string[] = []
    const result = await qrRegister({
      fetchImpl: fetch,
      renderQrImpl: async () => false,
      print: (line) => printed.push(line),
    })
    expect(result).toBeUndefined()
    expect(printed.some((l) => /manual entry/.test(l))).toBe(true)
  })
})
