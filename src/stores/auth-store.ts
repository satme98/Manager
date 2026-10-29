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

function parseTokenCookie(raw: string | undefined): string {
  if (!raw) return ''
  try {
    return JSON.parse(raw) as string
  } catch {
    return ''
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
  const initToken = parseTokenCookie(getCookie(ACCESS_TOKEN_COOKIE))
  const initUser = parseUserCookie(getCookie(AUTH_USER_COOKIE))

  return {
    auth: {
      user: initUser,
      setUser: (user) =>
        set((state) => {
          if (user) {
            setCookie(AUTH_USER_COOKIE, JSON.stringify(user))
          } else {
            removeCookie(AUTH_USER_COOKIE)
          }
          return { ...state, auth: { ...state.auth, user } }
        }),
      accessToken: initToken,
      setAccessToken: (accessToken) =>
        set((state) => {
          setCookie(ACCESS_TOKEN_COOKIE, JSON.stringify(accessToken))
          return { ...state, auth: { ...state.auth, accessToken } }
        }),
      setSession: (user, accessToken) =>
        set((state) => {
          setCookie(AUTH_USER_COOKIE, JSON.stringify(user))
          setCookie(ACCESS_TOKEN_COOKIE, JSON.stringify(accessToken))
          return {
            ...state,
            auth: { ...state.auth, user, accessToken },
          }
        }),
      resetAccessToken: () =>
        set((state) => {
          removeCookie(ACCESS_TOKEN_COOKIE)
          return { ...state, auth: { ...state.auth, accessToken: '' } }
        }),
      reset: () =>
        set((state) => {
          removeCookie(ACCESS_TOKEN_COOKIE)
          removeCookie(AUTH_USER_COOKIE)
          return {
            ...state,
            auth: { ...state.auth, user: null, accessToken: '' },
          }
        }),
    },
  }
})
