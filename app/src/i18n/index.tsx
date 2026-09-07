import { useEffect, useMemo, type ReactNode } from "react"
import { usePreferences } from "@/settings/context"
import { localeMeta } from "./locales"
import { zhCN } from "./messages/zh-CN"
import { dictionaries, formatMessage, setCurrentLocale } from "./runtime"
import { I18nContext } from "./context"
import type { I18nValue } from "./context"

export type { MessageKey } from "./messages/zh-CN"

export function I18nProvider({ children }: { children: ReactNode }) {
  const { preferences } = usePreferences()
  const locale = preferences.language
  useEffect(() => {
    setCurrentLocale(locale)
    document.documentElement.lang = localeMeta(locale).htmlLang
  }, [locale])
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      t: (key, vars) => {
        const dict = dictionaries[locale] ?? zhCN
        return formatMessage(dict[key] ?? zhCN[key], vars)
      },
    }),
    [locale],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
