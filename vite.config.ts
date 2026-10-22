import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const TEMPLATES = fileURLToPath(new URL('./src/gestures/templates.json', import.meta.url))
const EXAMPLES = fileURLToPath(new URL('./src/gestures/examples.json', import.meta.url))
const HOLDOUT = fileURLToPath(new URL('./src/gestures/holdout.json', import.meta.url))
const BACKUP = fileURLToPath(new URL('./src/gestures/templates.backup.json', import.meta.url))
const HOLDOUT_BACKUP = fileURLToPath(new URL('./src/gestures/holdout.backup.json', import.meta.url))

const read = (file: string) => readFile(file, 'utf8').catch(() => null)
const EMPTY = '{\n  "version": 1,\n  "samples": [\n\n  ]\n}\n'

/**
 * Dev only: lets record mode save straight into src/gestures/: the templates (templates.json), the
 * test strokes (holdout.json), and the gesture reference's pictures worked out from the templates
 * (examples.json). A save that changes templates.json or holdout.json first copies both as they were
 * to templates.backup.json and holdout.backup.json, which record mode can load back.
 */
function gestureTemplates(): Plugin {
  return {
    name: 'gesture-templates',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__gesture-templates', async (req, res) => {
        if (req.method === 'GET' && req.url === '/backup') {
          const templates = await read(BACKUP)
          if (templates === null) {
            res.statusCode = 404
            res.end('No backup yet: one is made the next time you save')
            return
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ templates, holdout: (await read(HOLDOUT_BACKUP)) ?? EMPTY }))
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
            const { templates, holdout, examples } = JSON.parse(body)
            for (const f of [templates, holdout]) {
              const t = JSON.parse(f)
              if (t?.version !== 1 || !Array.isArray(t.samples)) throw new Error('not a template file')
            }
            const e = JSON.parse(examples)
            if (e?.version !== 1 || typeof e.examples !== 'object') throw new Error('not an examples file')
            // Saving what's already on disk would overwrite the backup with a copy of the current files.
            const [curTemplates, curHoldout] = [await read(TEMPLATES), await read(HOLDOUT)]
            if (curTemplates !== templates || curHoldout !== holdout) {
              await writeFile(BACKUP, curTemplates ?? EMPTY)
              await writeFile(HOLDOUT_BACKUP, curHoldout ?? EMPTY)
              await writeFile(TEMPLATES, templates)
              await writeFile(HOLDOUT, holdout)
            }
            // Written even when the samples are unchanged: how examples are picked may have changed.
            if ((await read(EXAMPLES)) !== examples) await writeFile(EXAMPLES, examples)
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
