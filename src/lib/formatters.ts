import { format, isValid, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'

/**
 * Formats a number in Moroccan Dirham (MAD / DH) using French locale conventions.
 * Example: 1250.5 -> "1 250,50 DH"
 */
export function formatMAD(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—'
  }
  const formatted = new Intl.NumberFormat('fr-MA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
  return `${formatted} DH`
}

export const formatCurrencyMAD = formatMAD


/**
 * Formats a quantity in French locale without trailing unnecessary zeros.
 */
export function formatQuantity(
  value: number | null | undefined,
  unit?: string
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—'
  }
  const formatted = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(value)
  return unit ? `${formatted} ${unit}` : formatted
}

/**
 * Formats a Date or ISO date string as DD/MM/YYYY.
 */
export function formatDateFR(dateInput: Date | string | null | undefined): string {
  if (!dateInput) return '—'
  const date = typeof dateInput === 'string' ? parseISO(dateInput) : dateInput
  if (!isValid(date)) return '—'
  return format(date, 'dd/MM/yyyy', { locale: fr })
}

/**
 * Formats a Date or ISO date string as DD/MM/YYYY HH:mm.
 */
export function formatDateTimeFR(
  dateInput: Date | string | null | undefined
): string {
  if (!dateInput) return '—'
  const date = typeof dateInput === 'string' ? parseISO(dateInput) : dateInput
  if (!isValid(date)) return '—'
  return format(date, 'dd/MM/yyyy HH:mm', { locale: fr })
}
