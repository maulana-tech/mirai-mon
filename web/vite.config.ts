import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Serves the Vercel functions in `api/` during `vite dev`, so onboarding works without `vercel dev`.
 * Server-only env (DRIP_PRIVATE_KEY, ...) comes from web/.env and never reaches the client bundle.
 */
function devApi(env: Record<string, string>): Plugin {
  return {
    name: 'mirai-dev-api',
    apply: 'serve',
    configureServer(server) {
      for (const key of ['DRIP_PRIVATE_KEY', 'MONAD_RPC_URL', 'AUSD_ADDRESS', 'AUSD_FAUCET_ADDRESS', 'NANSEN_API_KEY']) {
        if (env[key]) process.env[key] = env[key]
      }
      for (const route of ['onboard', 'market']) {
        server.middlewares.use(`/api/${route}`, async (req, res) => {
          const handlers = (await server.ssrLoadModule(`/api/${route}.ts`)) as Record<
            string,
            ((request: Request) => Promise<Response>) | undefined
          >
          const handler = handlers[req.method ?? '']
          if (!handler) {
            res.statusCode = 405
            res.end()
            return
          }
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const body = req.method === 'GET' ? undefined : Buffer.concat(chunks)
          const response = await handler(new Request(`http://localhost/api/${route}`, { method: req.method, body }))
          res.statusCode = response.status
          res.setHeader('content-type', response.headers.get('content-type') ?? 'application/json')
          res.end(await response.text())
        })
      }
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), devApi(loadEnv(mode, process.cwd(), ''))],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
}))
