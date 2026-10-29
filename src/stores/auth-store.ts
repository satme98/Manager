import { create } from 'zustand'
import type { UserRecord } from '@/data/types'
import { getCookie, setCookie, removeCookie } from '@/lib/cookies'

const ACCESS_TOKEN_COOKIE = 'monarq_pb_token'
const AUTH_USER_COOKIE = 'monarq_pb_user'

interface AuthState {
  auth: {
    user: UserRecord | null
    setUser: (user: UserRecord | null) => void
    accessToken: string
    setAccessToken: (accessToken: string) => void
    setSession: (user: UserRecord, accessToken: string) => void
    resetAccessToken: () => void
    reset: () => void
  }
}

function readStorageItem(key: string): string | undefined {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const val = window.localStorage.getItem(key)
      if (val) return val
    }
  } catch {
    // Ignore storage access errors
  }
  const cookieVal = getCookie(key)
  if (!cookieVal) return undefined
  try {
    return decodeURIComponent(cookieVal)
  } catch {
    return cookieVal
  }
}

function writeStorageItem(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value)
    }
  } catch {
    // Ignore storage access errors
  }
  setCookie(key, encodeURIComponent(value))
}

function removeStorageItem(key: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key)
    }
  } catch {
    // Ignore storage access errors
  }
  removeCookie(key)
}

function parseTokenCookie(raw: string | undefined): string {
  if (!raw) return ''
  try {
    return JSON.parse(raw) as string
  } catch {
    return raw
  }
}

function parseUserCookie(raw: string | undefined): UserRecord | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as UserRecord
  } catch {
    return null
  }
}

export const useAuthStore = create<AuthState>()((set) => {
  const initToken = parseTokenCookie(readStorageItem(ACCESS_TOKEN_COOKIE))
  const initUser = parseUserCookie(readStorageItem(AUTH_USER_COOKIE))

  return {
    auth: {
      user: initUser,
      setUser: (user) =>
        set((state) => {
          if (user) {
            writeStorageItem(AUTH_USER_COOKIE, JSON.stringify(user))
          } else {
            removeStorageItem(AUTH_USER_COOKIE)
          }
          return { ...state, auth: { ...state.auth, user } }
        }),
      accessToken: initToken,
      setAccessToken: (accessToken) =>
        set((state) => {
          writeStorageItem(ACCESS_TOKEN_COOKIE, JSON.stringify(accessToken))
          return { ...state, auth: { ...state.auth, accessToken } }
        }),
      setSession: (user, accessToken) =>
        set((state) => {
          writeStorageItem(AUTH_USER_COOKIE, JSON.stringify(user))
          writeStorageItem(ACCESS_TOKEN_COOKIE, JSON.stringify(accessToken))
          return {
            ...state,
            auth: { ...state.auth, user, accessToken },
          }
        }),
      resetAccessToken: () =>
        set((state) => {
          removeStorageItem(ACCESS_TOKEN_COOKIE)
          return { ...state, auth: { ...state.auth, accessToken: '' } }
        }),
      reset: () =>
        set((state) => {
          removeStorageItem(ACCESS_TOKEN_COOKIE)
          removeStorageItem(AUTH_USER_COOKIE)
          return {
            ...state,
            auth: { ...state.auth, user: null, accessToken: '' },
          }
        }),
    },
  }
})
