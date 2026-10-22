import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const TEMPLATES = fileURLToPath(new URL('./src/gestures/templates.json', import.meta.url))
const EXAMPLES = fileURLToPath(new URL('./src/gestures/examples.json', import.meta.url))
const BACKUP = fileURLToPath(new URL('./src/gestures/templates.backup.json', import.meta.url))

/**
 * Dev only: lets record mode save straight into src/gestures/: the samples (templates.json) and the
 * gesture reference's pictures worked out from them (examples.json). Each save first copies the
 * previous templates.json to templates.backup.json, which record mode can load back.
 */
function gestureTemplates(): Plugin {
  return {
    name: 'gesture-templates',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__gesture-templates', async (req, res) => {
        if (req.method === 'GET' && req.url === '/backup') {
          try {
            res.setHeader('Content-Type', 'application/json')
            res.end(await readFile(BACKUP, 'utf8'))
          } catch {
            res.statusCode = 404
            res.end('No backup yet: one is made the next time you save')
          }
          return
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', async () => {
          try {
            const { templates, examples } = JSON.parse(body)
            const t = JSON.parse(templates), e = JSON.parse(examples)
            if (t?.version !== 1 || !Array.isArray(t.samples)) throw new Error('not a template file')
            if (e?.version !== 1 || typeof e.examples !== 'object') throw new Error('not an examples file')
            // Saving what's already on disk would overwrite the backup with a copy of the current file.
            const current = await readFile(TEMPLATES, 'utf8').catch(() => null)
            if (current !== templates) {
              if (current !== null) await writeFile(BACKUP, current)
              await writeFile(TEMPLATES, templates)
            }
            // Written even when the samples are unchanged: how examples are picked may have changed.
            if ((await readFile(EXAMPLES, 'utf8').catch(() => null)) !== examples) await writeFile(EXAMPLES, examples)
            res.statusCode = 204
            res.end()
          } catch (err) {
            res.statusCode = 400
            res.end(String(err))
          }
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), gestureTemplates()],
  define: {
    // Hidden gesture record mode, opened with RECORD_MODE=true (from the shell or a .env file).
    'import.meta.env.RECORD_MODE': JSON.stringify(loadEnv(mode, process.cwd(), '').RECORD_MODE === 'true'),
  },
}))
