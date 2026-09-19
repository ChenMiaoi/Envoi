import { useT } from "@/i18n/useT"

export function RemoteUnavailable() {
  const { t } = useT()
  return (
    <div
      role="status"
      className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground"
    >
      {t("remote.featureUnavailable")}
    </div>
  )
}
