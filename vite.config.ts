import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { APP_VERSION } from './src/lib/constants'

/** /version.json in every build — the app polls it to offer updates */
const emitVersion = (): Plugin => ({
  name: 'emit-version',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: APP_VERSION }) })
  },
})

export default defineConfig({
  plugins: [react(), tailwindcss(), emitVersion()],
})
