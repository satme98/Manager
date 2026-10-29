import type { SubmitEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { ConfirmDialog } from './confirm-dialog'

describe('ConfirmDialog', () => {
  it('renders title, description, and default French buttons', async () => {
    const { getByRole, getByText } = await render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Supprimer l'élément"
        desc='Cette action est irréversible.'
        handleConfirm={vi.fn()}
      />
    )

    await expect
      .element(getByRole('heading', { name: "Supprimer l'élément" }))
      .toBeInTheDocument()
    await expect
      .element(getByText('Cette action est irréversible.'))
      .toBeInTheDocument()
    await expect
      .element(getByRole('button', { name: 'Annuler' }))
      .toBeInTheDocument()
    await expect
      .element(getByRole('button', { name: 'Continuer' }))
      .toBeInTheDocument()
  })

  it('calls handleConfirm when the confirm button is clicked', async () => {
    const handleConfirm = vi.fn()
    const { getByRole } = await render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title='Se déconnecter'
        desc='Êtes-vous sûr ?'
        confirmText='Se déconnecter'
        handleConfirm={handleConfirm}
      />
    )

    await userEvent.click(getByRole('button', { name: 'Se déconnecter' }))
    expect(handleConfirm).toHaveBeenCalledOnce()
  })

  it('disables confirm when disabled is true', async () => {
    const handleConfirm = vi.fn()
    const { getByRole } = await render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title='Danger'
        desc='...'
        disabled
        handleConfirm={handleConfirm}
      />
    )

    const confirm = getByRole('button', { name: 'Continuer' })
    await expect.element(confirm).toBeDisabled()
    expect(handleConfirm).not.toHaveBeenCalled()
  })

  it('when isLoading is true, disables cancel and confirm', async () => {
    const handleConfirm = vi.fn()
    const { getByRole } = await render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title='Chargement'
        desc='...'
        isLoading
        handleConfirm={handleConfirm}
      />
    )

    await expect.element(getByRole('button', { name: 'Annuler' })).toBeDisabled()
    await expect
      .element(getByRole('button', { name: 'Continuer' }))
      .toBeDisabled()
  })

  it('supports custom button texts', async () => {
    const { getByRole } = await render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title='Supprimer'
        desc='...'
        cancelBtnText='Non'
        confirmText='Oui'
        handleConfirm={vi.fn()}
      />
    )

    await expect
      .element(getByRole('button', { name: 'Non' }))
      .toBeInTheDocument()
    await expect
      .element(getByRole('button', { name: 'Oui' }))
      .toBeInTheDocument()
  })

  it('submits the desc form when confirm is clicked (form prop, no handleConfirm)', async () => {
    const handleFormSubmit = vi.fn((e: SubmitEvent<HTMLFormElement>) => {
      e.preventDefault()
    })

    const { getByRole } = await render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title='Supprimer'
        form='delete-form'
        desc={
          <form
            id='delete-form'
            onSubmit={handleFormSubmit}
            className='space-y-4'
          >
            <p>Confirmer la suppression.</p>
          </form>
        }
        confirmText='Supprimer'
        destructive
      />
    )

    await userEvent.click(getByRole('button', { name: 'Supprimer' }))

    expect(handleFormSubmit).toHaveBeenCalledOnce()
  })
})
