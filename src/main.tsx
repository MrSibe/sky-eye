import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '@fontsource-variable/ibm-plex-sans'
import '@fontsource/ibm-plex-mono'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource-variable/noto-sans-sc'
import './index.css'
import './App.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
