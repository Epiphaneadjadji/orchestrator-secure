import { useState, useEffect } from 'react'

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [canInstall, setCanInstall] = useState(false)
  const isInstalled = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e); setCanInstall(true) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const install = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') { setCanInstall(false); setDeferredPrompt(null) }
  }

  return { canInstall, install, isInstalled }
}
