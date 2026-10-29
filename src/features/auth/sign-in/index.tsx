import { useSearch } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })

  return (
    <AuthLayout>
      <Card className='gap-4'>
        <CardHeader>
          <CardTitle className='text-base tracking-tight'>Connexion</CardTitle>
          <CardDescription>
            Saisissez vos identifiants pour accéder à la gestion de
            l&apos;économat et des stocks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UserAuthForm redirectTo={redirect} />
        </CardContent>
        <CardFooter className='border-t border-border pt-3'>
          <p className='w-full text-center text-xs text-muted-foreground'>
            Accès réservé au personnel autorisé (Admin, Manager, Économat,
            Cuisine, Consultation).
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
