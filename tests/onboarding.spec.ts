import { describe, expect, it } from 'vitest'
import {
  ACCOUNTS_BASE_URLS,
  OPENPLATFORM_URLS,
  REGISTRATION_PATH,
  probeBot,
  qrRegister,
  regBegin,
  regInit,
  regPoll,
  renderQr,
} from '../src/onboarding.ts'

describe('onboarding module surface (M1 skeleton)', () => {
  it('pins the registration constants', () => {
    expect(ACCOUNTS_BASE_URLS.feishu).toBe('https://accounts.feishu.cn')
    expect(ACCOUNTS_BASE_URLS.lark).toBe('https://accounts.larksuite.com')
    expect(OPENPLATFORM_URLS.feishu).toBe('https://open.feishu.cn')
    expect(REGISTRATION_PATH).toBe('/oauth/v1/app/registration')
  })

  it('exports the public functions as callables', () => {
    for (const fn of [regInit, regBegin, regPoll, qrRegister, probeBot, renderQr]) {
      expect(typeof fn).toBe('function')
    }
  })
})
