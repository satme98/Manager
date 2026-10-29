import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  Building2,
  ChevronRight,
  Laptop,
  Moon,
  Package,
  Receipt,
  Sun,
} from 'lucide-react'
import { repository } from '@/data'
import { formatDateFR } from '@/lib/formatters'
import { canAccessRoute, canPerformCollectionAction } from '@/lib/rbac'
import { useAuthStore } from '@/stores/auth-store'
import { useSearch } from '@/context/search-provider'
import { useTheme } from '@/context/theme-provider'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { sidebarData } from './layout/data/sidebar-data'
import { ScrollArea } from './ui/scroll-area'

export function CommandMenu() {
  const navigate = useNavigate()
  const { setTheme } = useTheme()
  const { open, setOpen } = useSearch()
  const { auth } = useAuthStore()
  const activeRole = auth.user?.role ?? 'admin'
  const isAuthenticated = Boolean(auth.user)
  const canListSuppliers = canPerformCollectionAction(
    activeRole,
    'suppliers',
    'list'
  )

  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: () => repository.listProducts(),
    enabled: open && isAuthenticated,
  })

  const suppliersQuery = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => repository.listSuppliers(),
    enabled: open && isAuthenticated && canListSuppliers,
  })

  const purchasesQuery = useQuery({
    queryKey: ['purchases'],
    queryFn: () => repository.listPurchases(),
    enabled: open && isAuthenticated && activeRole !== 'cuisine',
  })

  const activeProducts = React.useMemo(
    () => (productsQuery.data ?? []).filter((p) => !p.archived),
    [productsQuery.data]
  )

  const activeSuppliers = React.useMemo(
    () => (suppliersQuery.data ?? []).filter((s) => !s.archived),
    [suppliersQuery.data]
  )

  const activeInvoices = React.useMemo(
    () =>
      (purchasesQuery.data?.headers ?? []).filter(
        (p) =>
          !p.reversed_of &&
          p.correction_status !== 'reversed' &&
          p.correction_status !== 'corrected' &&
          Boolean(p.invoice_no?.trim())
      ),
    [purchasesQuery.data]
  )

  const runCommand = React.useCallback(
    (command: () => unknown) => {
      setOpen(false)
      command()
    },
    [setOpen]
  )

  const navigateToProductDetail = (productId: string) => {
    runCommand(() => {
      void navigate({ to: '/produits' })
      setTimeout(() => {
        window.history.replaceState(
          null,
          '',
          `/produits?productId=${encodeURIComponent(productId)}`
        )
        window.dispatchEvent(new Event('monarq:navigate'))
      }, 30)
    })
  }

  const navigateToSupplierDetail = (supplierId: string) => {
    runCommand(() => {
      void navigate({ to: '/fournisseurs' })
      setTimeout(() => {
        window.history.replaceState(
          null,
          '',
          `/fournisseurs?supplierId=${encodeURIComponent(supplierId)}`
        )
        window.dispatchEvent(new Event('monarq:navigate'))
      }, 30)
    })
  }

  const navigateToInvoice = (invoiceNo: string) => {
    runCommand(() => {
      void navigate({ to: '/factures-paiements' })
      setTimeout(() => {
        window.history.replaceState(
          null,
          '',
          `/factures-paiements?q=${encodeURIComponent(invoiceNo)}`
        )
        window.dispatchEvent(new Event('monarq:navigate'))
      }, 30)
    })
  }

  const filteredGroups = sidebarData.navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        item.url ? canAccessRoute(activeRole, String(item.url)) : true
      ),
    }))
    .filter((g) => g.items.length > 0)

  return (
    <CommandDialog modal open={open} onOpenChange={setOpen}>
      <CommandInput placeholder='Rechercher un produit (nom, réf.), une facture (N°), un fournisseur ou une page...' />
      <CommandList>
        <ScrollArea type='hover' className='h-80 pe-1'>
          <CommandEmpty>Aucun résultat trouvé.</CommandEmpty>

          {activeProducts.length > 0 && (
            <CommandGroup heading='Produits'>
              {activeProducts.slice(0, 150).map((product) => (
                <CommandItem
                  key={`prod-${product.id}`}
                  value={`${product.ref} ${product.name} ${product.category || ''}`}
                  onSelect={() => navigateToProductDetail(product.id)}
                >
                  <Package className='mr-2 size-4 text-[#008060]' />
                  <span className='font-mono text-xs font-semibold'>
                    {product.ref}
                  </span>
                  <span className='ml-2 truncate'>{product.name}</span>
                  {product.category && (
                    <span className='ml-auto text-xs text-muted-foreground'>
                      {product.category}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {canListSuppliers && activeSuppliers.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading='Fournisseurs'>
                {activeSuppliers.slice(0, 80).map((supplier) => (
                  <CommandItem
                    key={`sup-${supplier.id}`}
                    value={`${supplier.name} ${supplier.contact || ''} ${supplier.phone || ''}`}
                    onSelect={() => navigateToSupplierDetail(supplier.id)}
                  >
                    <Building2 className='mr-2 size-4 text-[#6D7175]' />
                    <span className='truncate font-medium'>
                      {supplier.name}
                    </span>
                    {supplier.contact && (
                      <span className='ml-auto text-xs text-muted-foreground'>
                        {supplier.contact}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {activeInvoices.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading='Factures & Bons d’entrée'>
                {activeInvoices.slice(0, 60).map((inv) => (
                  <CommandItem
                    key={`inv-${inv.id}`}
                    value={`Facture ${inv.invoice_no} ${inv.date}`}
                    onSelect={() => navigateToInvoice(inv.invoice_no)}
                  >
                    <Receipt className='mr-2 size-4 text-[#B98900]' />
                    <span className='font-mono text-xs font-semibold'>
                      {inv.invoice_no}
                    </span>
                    <span className='ml-2 text-xs text-muted-foreground'>
                      ({formatDateFR(inv.date)})
                    </span>
                    <span className='ml-auto text-xs font-medium'>
                      {inv.payment_status === 'paid' ? 'Payé' : 'Impayé'}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          <CommandSeparator />
          {filteredGroups.map((group) => (
            <CommandGroup key={group.title} heading={group.title}>
              {group.items.map((navItem, i) => {
                if (navItem.url)
                  return (
                    <CommandItem
                      key={`${navItem.url}-${i}`}
                      value={navItem.title}
                      onSelect={() => {
                        runCommand(() => navigate({ to: navItem.url }))
                      }}
                    >
                      <div className='flex size-4 items-center justify-center'>
                        <ArrowRight className='size-2 text-muted-foreground/80' />
                      </div>
                      {navItem.title}
                    </CommandItem>
                  )

                return navItem.items?.map((subItem, i) => (
                  <CommandItem
                    key={`${navItem.title}-${subItem.url}-${i}`}
                    value={`${navItem.title}-${subItem.url}`}
                    onSelect={() => {
                      runCommand(() => navigate({ to: subItem.url }))
                    }}
                  >
                    <div className='flex size-4 items-center justify-center'>
                      <ArrowRight className='size-2 text-muted-foreground/80' />
                    </div>
                    {navItem.title} <ChevronRight /> {subItem.title}
                  </CommandItem>
                ))
              })}
            </CommandGroup>
          ))}
          <CommandSeparator />
          <CommandGroup heading='Thème'>
            <CommandItem onSelect={() => runCommand(() => setTheme('light'))}>
              <Sun /> <span>Clair</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => setTheme('dark'))}>
              <Moon className='scale-90' />
              <span>Sombre</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => setTheme('system'))}>
              <Laptop />
              <span>Système</span>
            </CommandItem>
          </CommandGroup>
        </ScrollArea>
      </CommandList>
    </CommandDialog>
  )
}
