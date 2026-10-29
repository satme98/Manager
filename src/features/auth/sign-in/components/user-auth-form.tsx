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

export function UserAuthForm({
  className,
  redirectTo,
  ...props
}: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()
  const { auth } = useAuthStore()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)
    try {
      const { user, token } = await repository.login(data.email, data.password)
      auth.setUser(user)
      auth.setAccessToken(token)
      toast.success(
        `Bienvenue, ${user.name} (${ROLE_LABELS[user.role]}) !`
      )
      const targetPath = redirectTo || '/'
      navigate({ to: targetPath, replace: true })
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

  function fillPreviewAdmin() {
    form.setValue('email', 'admin@monarq.ma', { shouldValidate: true })
    form.setValue('password', 'admin1234', { shouldValidate: true })
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
                <Input placeholder='nom@monarq.ma' {...field} />
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

        {repository.adapterName === 'memory' && (
          <div className='mt-2 rounded-md border border-border bg-muted/40 p-2.5 text-xs'>
            <div className='flex items-center justify-between gap-2'>
              <div>
                <p className='font-medium text-foreground'>
                  Aperçu AI Studio (Adaptateur mémoire)
                </p>
                <p className='text-muted-foreground'>
                  Admin démo : <span className='font-mono'>admin@monarq.ma</span>{' '}
                  / <span className='font-mono'>admin1234</span>
                </p>
              </div>
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='h-7 px-2 text-xs'
                onClick={fillPreviewAdmin}
              >
                <KeyRound className='mr-1 h-3 w-3' />
                Remplir
              </Button>
            </div>
          </div>
        )}
      </form>
    </Form>
  )
}
