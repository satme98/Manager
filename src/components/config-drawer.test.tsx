import { clearCookies } from '@/test-utils/cookies'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { getCookie, setCookie } from '@/lib/cookies'
import { DirectionProvider } from '@/context/direction-provider'
import { LayoutProvider } from '@/context/layout-provider'
import { ThemeProvider } from '@/context/theme-provider'
import { SidebarProvider } from '@/components/ui/sidebar'
import { ConfigDrawer } from './config-drawer'

async function renderConfigDrawer({
  sidebarDefaultOpen = true,
}: {
  sidebarDefaultOpen?: boolean
} = {}) {
  return await render(
    <DirectionProvider>
      <ThemeProvider>
        <LayoutProvider>
          <SidebarProvider defaultOpen={sidebarDefaultOpen}>
            <ConfigDrawer />
          </SidebarProvider>
        </LayoutProvider>
      </ThemeProvider>
    </DirectionProvider>
  )
}

async function openDrawer(screen: RenderResult) {
  await userEvent.click(
    screen.getByRole('button', { name: /^Ouvrir les paramètres d'affichage$/i })
  )
  await expect
    .element(screen.getByText(/^Affichage & Disposition$/i))
    .toBeInTheDocument()
}

describe('ConfigDrawer (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCookies()
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.removeAttribute('dir')
  })

  it('opens the drawer and renders the sections in French', async () => {
    const screen = await renderConfigDrawer()
    await openDrawer(screen)

    const drawer = screen.getByRole('dialog', {
      name: /affichage & disposition/i,
    })

    await expect.element(drawer).toBeInTheDocument()
    await expect.element(drawer.getByText(/^Thème$/i)).toBeInTheDocument()
    await expect
      .element(drawer.getByText(/^Disposition$/i))
      .toBeInTheDocument()
    await expect
      .element(drawer.getByText(/^Barre latérale$/i).first())
      .toBeInTheDocument()
    await expect.element(drawer.getByText(/^Direction$/i)).toBeInTheDocument()
    await expect
      .element(
        screen.getByRole('button', {
          name: /réinitialiser tous les paramètres par défaut/i,
        })
      )
      .toBeInTheDocument()
  })

  describe('theme preference', () => {
    it('applies dark theme to <html> and cookie', async () => {
      const screen = await renderConfigDrawer()
      await openDrawer(screen)
      await userEvent.click(
        screen.getByRole('radio', { name: /sélectionner sombre/i })
      )
      await vi.waitFor(() =>
        expect(document.documentElement.classList.contains('dark')).toBe(true)
      )
      expect(getCookie('vite-ui-theme')).toBe('dark')
    })

    it('applies light theme to <html> and cookie after dark', async () => {
      setCookie('vite-ui-theme', 'dark')
      const screen = await renderConfigDrawer()
      await openDrawer(screen)
      await userEvent.click(
        screen.getByRole('radio', { name: /sélectionner clair/i })
      )
      await vi.waitFor(() =>
        expect(document.documentElement.classList.contains('light')).toBe(true)
      )
      expect(getCookie('vite-ui-theme')).toBe('light')
    })
  })
})
