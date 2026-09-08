import { useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import { useT } from "@/i18n/useT"
import { editorFonts, textFonts } from "./model"
import { fontCss, fontId, systemFonts } from "./fonts"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandGroup,
} from "@/components/ui/command"

export function FontPicker({
  value,
  onChange,
  label,
  editor = false,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  editor?: boolean
}) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [fonts, setFonts] = useState<Awaited<ReturnType<typeof systemFonts>>>([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const legacy = editor ? editorFonts : textFonts
  const selected = Object.entries(legacy).find(([id]) => id === value)?.[1]
  async function show() {
    setOpen(true)
    setQuery("")
    setFonts([])
    setLoading(true)
    setFailed(false)
    try {
      setFonts(await systemFonts())
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }
  const filtered = fonts.filter((font) =>
    font.family.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  )
  function option(id: string, name: string) {
    return (
      <CommandItem
        key={id}
        value={id}
        onSelect={() => {
          onChange(id)
          setOpen(false)
        }}
        style={{ fontFamily: fontCss(id, legacy) }}
      >
        <span className="min-w-0 truncate">{name}</span>
        {value === id && <Check className="ml-auto size-4" />}
      </CommandItem>
    )
  }
  return (
    <>
      <button
        aria-label={label}
        onClick={() => void show()}
        className="flex min-h-9 max-w-64 items-center gap-3 rounded-lg border border-input bg-background px-3 py-2 text-xs"
      >
        <span className="truncate" style={{ fontFamily: fontCss(value, legacy) }}>
          {selected ? t(selected.labelKey) : value.slice(6)}
        </span>
        <ChevronDown className="size-3 shrink-0" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-3 sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>
          <Command shouldFilter={false}>
            <CommandInput
              aria-label={t("font.search")}
              placeholder={t("font.search")}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandGroup>{option("system", t(legacy.system.labelKey))}</CommandGroup>
              {editor && (
                <CommandGroup heading={t("font.monospace")}>
                  {filtered
                    .filter((font) => font.mono)
                    .map((font) => option(fontId(font.family), font.family))}
                </CommandGroup>
              )}
              <CommandGroup heading={editor ? t("font.allOthers") : undefined}>
                {filtered
                  .filter((font) => !editor || !font.mono)
                  .map((font) => option(fontId(font.family), font.family))}
              </CommandGroup>
              {(loading || failed || !filtered.length) && (
                <p role="status" className="p-4 text-xs text-muted-foreground">
                  {t(loading ? "font.loading" : failed ? "font.failed" : "font.empty")}
                </p>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  )
}
