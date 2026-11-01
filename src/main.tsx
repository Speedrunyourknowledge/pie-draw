import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { autosaveSession, restoreSession } from './session'

// The last session (drawing, undo history, chat) comes back before the first render, so a reload
// shows the same canvas instead of flashing an empty one.
await restoreSession()
autosaveSession()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
