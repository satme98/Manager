import { AxiosError } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleServerError } from './handle-server-error'

const toastError = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({
  toast: {
    error: toastError,
  },
}))

beforeEach(() => {
  vi.mocked(toastError).mockClear()
})

describe('handleServerError', () => {
  it('shows a generic French message when the error is an unknown object', () => {
    handleServerError({ unknown: true })

    expect(toastError).toHaveBeenCalledWith(
      'Une erreur inattendue est survenue.'
    )
  })

  it('extracts error.message when the error is a standard Error instance', () => {
    handleServerError(new Error('Stock insuffisant pour ce produit.'))

    expect(toastError).toHaveBeenCalledWith(
      'Stock insuffisant pour ce produit.'
    )
  })

  it('maps a plain object with status 204 to the French no-content message', () => {
    handleServerError({ status: 204 })

    expect(toastError).toHaveBeenCalledWith('Aucun contenu.')
  })

  it('prefers the API title when the error is an Axios error with response data', () => {
    const error = new AxiosError('Bad request')
    error.response = {
      status: 422,
      data: { title: 'Validation échouée' },
    } as AxiosError['response']

    handleServerError(error)

    expect(toastError).toHaveBeenCalledWith('Validation échouée')
  })

  it('falls back to the generic French message when Axios response has no data.title and empty message', () => {
    const error = new AxiosError('')
    error.response = {
      status: 500,
      data: {},
    } as AxiosError['response']

    handleServerError(error)

    expect(toastError).toHaveBeenCalledWith(
      'Une erreur inattendue est survenue.'
    )
  })

  it('does not log errors to the console', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const err = new Error('silent')

    handleServerError(err)

    expect(log).not.toHaveBeenCalled()

    log.mockRestore()
  })
})

