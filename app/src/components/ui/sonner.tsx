import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { usePreferences } from "@/settings/context"
import { themes } from "@/settings/model"
import { useT } from "@/i18n/useT"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { preferences } = usePreferences()
  const { t } = useT()

  return (
    <Sonner
      theme={themes[preferences.theme].mode}
      position="bottom-right"
      offset={{ bottom: 40, right: 20 }}
      mobileOffset={{ bottom: 36, right: 12, left: 12 }}
      duration={4000}
      visibleToasts={3}
      closeButton
      toastOptions={{ closeButtonAriaLabel: t("common.close") }}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "hsl(var(--popover))",
          "--normal-text": "hsl(var(--popover-foreground))",
          "--normal-border": "hsl(var(--border))",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
