import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const TEMPLATES = fileURLToPath(new URL('./src/gestures/templates.json', import.meta.url))
const EXAMPLES = fileURLToPath(new URL('./src/gestures/examples.json', import.meta.url))

/**
 * Dev only: lets record mode save straight into src/gestures/: the samples (templates.json) and the
 * gesture reference's pictures worked out from them (examples.json).
 */
function gestureTemplates(): Plugin {
  return {
    name: 'gesture-templates',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__gesture-templates', (req, res) => {
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
            await writeFile(TEMPLATES, templates)
            await writeFile(EXAMPLES, examples)
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
export default defineConfig({
  plugins: [react(), gestureTemplates()],
})
