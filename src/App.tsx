import { useEffect } from 'react'
import { useStore } from './store'
import { syncConfigured } from './lib/sync'
import Home from './components/Home'
import DeckView from './components/DeckView'
import Editor from './components/Editor'
import Review from './components/Review'
import Toast from './components/Toast'

export default function App() {
  const screen = useStore((s) => s.screen)
  const loaded = useStore((s) => s.loaded)
  const init = useStore((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  // push pending changes when the user leaves the app
  useEffect(() => {
    const onVis = () => {
      const s = useStore.getState()
      if (document.visibilityState === 'hidden' && syncConfigured(s.settings)) void s.syncNow(true)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  if (!loaded) return null

  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      {screen === 'home' && <Home />}
      {screen === 'deck' && <DeckView />}
      {screen === 'editor' && <Editor />}
      {screen === 'review' && <Review />}
      <Toast />
    </div>
  )
}
