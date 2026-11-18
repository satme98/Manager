import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  ignore: [
    'src/components/ui/**',
    'src/tanstack-table.d.ts',
    'pb_data/**',
    'pb_public/**',
    'pb_hooks/**',
    'pb_migrations/**',
    'scripts/**',
  ],
}

export default config