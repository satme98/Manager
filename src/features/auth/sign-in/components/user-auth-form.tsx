import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { KeyRound, Loader2, LogIn } from 'lucide-react'
import { toast } from 'sonner'
import { repository } from '@/data'
import { ROLE_LABELS } from '@/lib/rbac'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/password-input'

const formSchema = z.object({
  email: z.email({
    error: (iss) =>
      iss.input === '' ? 'Veuillez saisir votre adresse e-mail.' : undefined,
  }),
  password: z
    .string()
    .min(1, 'Veuillez saisir votre mot de passe.')
    .min(7, 'Le mot de passe doit contenir au moins 7 caractères.'),
})

interface UserAuthFormProps extends React.HTMLAttributes<HTMLFormElement> {
  redirectTo?: string
}

function resolveSafeRedirectPath(redirectTo?: string): string {
  if (!redirectTo) return '/'
  try {
    const base =
      typeof window !== 'undefined'
        ? window.location.origin
        : 'http://localhost:3000'
    const url = new URL(redirectTo, base)
    const pathname = url.pathname || '/'
    if (pathname.startsWith('/sign-in') || pathname.startsWith('/clerk')) {
      return '/'
    }
    return pathname
  } catch {
    const clean = redirectTo.split('?')[0].split('#')[0]
    if (!clean || !clean.startsWith('/') || clean.startsWith('/sign-in')) {
      return '/'
    }
    return clean
  }
}

const QUICK_ACCOUNTS = [
  {
    label: 'Admin',
    email: 'admin@monarq.ma',
    password: 'admin1234',
  },
  {
    label: 'Manager',
    email: 'manager@monarq.ma',
    password: 'manager1234',
  },
  {
    label: 'Magasinier',
    email: 'magasinier@monarq.ma',
    password: 'magasinier1234',
  },
  {
    label: 'Cuisine',
    email: 'cuisine@monarq.ma',
    password: 'cuisine1234',
  },
  {
    label: 'Consultation',
    email: 'consultation@monarq.ma',
    password: 'consultation1234',
  },
] as const

export function UserAuthForm({
  className,
  redirectTo,
  ...props
}: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()
  const { auth } = useAuthStore()
  const isMemoryMode = repository.adapterName === 'memory'

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: isMemoryMode ? 'admin@monarq.ma' : '',
      password: isMemoryMode ? 'admin1234' : '',
    },
  })

  async function performLogin(email: string, password: string) {
    setIsLoading(true)
    try {
      const { user, token } = await repository.login(email, password)
      auth.setSession(user, token)
      toast.success(
        `Bienvenue, ${user.name} (${ROLE_LABELS[user.role]}) !`
      )
      const targetPath = resolveSafeRedirectPath(redirectTo)
      await navigate({ to: targetPath, replace: true })
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Erreur de connexion. Vérifiez vos identifiants.'
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  async function onSubmit(data: z.infer<typeof formSchema>) {
    await performLogin(data.email, data.password)
  }

  async function handleQuickLogin(email: string, password: string) {
    form.setValue('email', email, { shouldValidate: true })
    form.setValue('password', password, { shouldValidate: true })
    await performLogin(email, password)
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-3', className)}
        {...props}
      >
        <FormField
          control={form.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Adresse e-mail</FormLabel>
              <FormControl>
                <Input placeholder='admin@monarq.ma' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Mot de passe</FormLabel>
              <FormControl>
                <PasswordInput placeholder='********' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button className='mt-2' disabled={isLoading} type='submit'>
          {isLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
          Se connecter
        </Button>

        {isMemoryMode && (
          <div className='mt-2 rounded-md border border-[#E1E3E5] bg-[#F6F6F7] p-3 text-xs'>
            <div className='mb-2 flex items-center justify-between gap-2'>
              <div>
                <p className='font-semibold text-[#202223]'>
                  Connexion directe en 1 clic (Aperçu)
                </p>
                <p className='text-[#6D7175]'>
                  Identifiants par défaut :{' '}
                  <span className='font-mono font-medium text-[#202223]'>
                    admin@monarq.ma
                  </span>{' '}
                  /{' '}
                  <span className='font-mono font-medium text-[#202223]'>
                    admin1234
                  </span>
                </p>
              </div>
            </div>
            <div className='flex flex-wrap gap-1.5'>
              {QUICK_ACCOUNTS.map((acc) => (
                <Button
                  key={acc.email}
                  type='button'
                  variant='outline'
                  size='sm'
                  disabled={isLoading}
                  className='h-7 bg-white px-2.5 text-xs font-medium hover:bg-[#303030] hover:text-white'
                  onClick={() => handleQuickLogin(acc.email, acc.password)}
                >
                  <KeyRound className='mr-1 h-3 w-3' />
                  {acc.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </form>
    </Form>
  )
}
