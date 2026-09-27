import { useEffect, useSyncExternalStore } from 'react'
import { App } from './App'
import { useMe } from './auth/hooks'
import { isLang, loadUiLang, subscribeUiLang, uiLang } from './strings'

/**
 * GOAL_2.0 P5.2: the screens follow the signed-in member's on-screen language (ui_lang, else the
 * language they speak in). A change re-mounts the app under the new strings; the query cache and
 * the URL survive it.
 */
export function Root() {
  const me = useMe()
  const m = me.data?.membership
  const wanted = m ? (m.ui_lang ?? m.lang) : null
  useEffect(() => {
    if (isLang(wanted)) loadUiLang(wanted).catch(() => { /* chunk failed: stay in the current language */ })
  }, [wanted])
  const lang = useSyncExternalStore(subscribeUiLang, uiLang)
  return <App key={lang} />
}
