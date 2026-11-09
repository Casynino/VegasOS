"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import { useT } from "@/i18n/client"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const t = useT()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // under the clock / Dynamic Island in the home-screen app (no inset in a normal tab: the same 24px / 16px as the default)
      offset={{ top: "calc(env(safe-area-inset-top, 0px) + 24px)", right: 24, bottom: 24, left: 24 }}
      mobileOffset={{ top: "calc(env(safe-area-inset-top, 0px) + 16px)", right: 16, bottom: 16, left: 16 }}
      containerAriaLabel={t("Notifications")}
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
        closeButtonAriaLabel: t("Close toast"),
      }}
      {...props}
    />
  )
}

export { Toaster }
