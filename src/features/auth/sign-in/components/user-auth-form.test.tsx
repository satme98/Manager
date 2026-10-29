import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { type Locator, userEvent } from 'vitest/browser'
import { UserAuthForm } from './user-auth-form'

const FORM_MESSAGES = {
  emailEmpty: 'Veuillez saisir votre adresse e-mail.',
  passwordEmpty: 'Veuillez saisir votre mot de passe.',
  passwordShort: 'Le mot de passe doit contenir au moins 7 caractères.',
} as const

const navigate = vi.fn()
const setUserMock = vi.fn()
const setAccessTokenMock = vi.fn()
const loginMock = vi.fn()

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    auth: {
      setUser: setUserMock,
      setAccessToken: setAccessTokenMock,
    },
  }),
}))

vi.mock('@/data', () => ({
  repository: {
    adapterName: 'memory',
    login: (...args: unknown[]) => loginMock(...args),
  },
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => navigate,
  }
})

describe('UserAuthForm', () => {
  describe('Rendering without redirectTo', () => {
    let screen: RenderResult
    let emailInput: Locator
    let passwordInput: Locator
    let signInButton: Locator

    beforeEach(async () => {
      vi.clearAllMocks()
      loginMock.mockResolvedValue({
        user: {
          id: 'usr_admin_01',
          email: 'a@b.com',
          name: 'Administrateur',
          role: 'admin',
          active: true,
          created: '2025-01-01T00:00:00.000Z',
          updated: '2025-01-01T00:00:00.000Z',
        },
        token: 'mock-pb-token',
      })
      screen = await render(<UserAuthForm />)
      emailInput = screen.getByRole('textbox', { name: /^Adresse e-mail$/i })
      passwordInput = screen.getByLabelText(/^Mot de passe$/i)
      signInButton = screen.getByRole('button', { name: /^Se connecter$/i })
    })

    it('renders fields and submit button in French', async () => {
      await expect.element(emailInput).toBeInTheDocument()
      await expect.element(passwordInput).toBeInTheDocument()
      await expect.element(signInButton).toBeInTheDocument()
    })

    it('shows validation messages when submitting empty form', async () => {
      await userEvent.click(signInButton)

      await expect
        .element(screen.getByText(FORM_MESSAGES.emailEmpty))
        .toBeInTheDocument()
      await expect
        .element(screen.getByText(FORM_MESSAGES.passwordEmpty))
        .toBeInTheDocument()
    })

    it('authenticates and navigates to default route on success', async () => {
      await userEvent.fill(emailInput, 'a@b.com')
      await userEvent.fill(passwordInput, '1234567')

      await userEvent.click(signInButton)

      await vi.waitFor(() => expect(setUserMock).toHaveBeenCalledOnce())
      expect(setUserMock).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'a@b.com',
          role: 'admin',
        })
      )
      expect(setAccessTokenMock).toHaveBeenCalledWith('mock-pb-token')

      await vi.waitFor(() =>
        expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true })
      )
    })
  })

  it('navigates to redirectTo when provided', async () => {
    vi.clearAllMocks()
    loginMock.mockResolvedValue({
      user: {
        id: 'usr_admin_01',
        email: 'a@b.com',
        name: 'Administrateur',
        role: 'admin',
        active: true,
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
      },
      token: 'mock-pb-token',
    })

    const { getByRole, getByLabelText } = await render(
      <UserAuthForm redirectTo='/parametres' />
    )

    await userEvent.fill(
      getByRole('textbox', { name: /Adresse e-mail/i }),
      'a@b.com'
    )
    await userEvent.fill(getByLabelText('Mot de passe'), '1234567')

    await userEvent.click(getByRole('button', { name: /Se connecter/i }))

    await vi.waitFor(() => expect(setUserMock).toHaveBeenCalledOnce())
    expect(setAccessTokenMock).toHaveBeenCalledOnce()

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/parametres',
        replace: true,
      })
    )
  })
})
