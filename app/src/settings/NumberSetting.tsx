import { useState } from "react"
import { Minus, Plus, RotateCcw } from "lucide-react"
import { useT } from "@/i18n/useT"

export function NumberSetting({
  value,
  onChange,
  label,
  min,
  max,
  step,
  defaultValue,
  unit,
}: {
  value: number
  onChange: (value: number) => void
  label: string
  min: number
  max: number
  step: number
  defaultValue: number
  unit: string
}) {
  const { t } = useT()
  const [draft, setDraft] = useState<string | null>(null)
  function commit(text: string) {
    const number = Number(text)
    if (text.trim() && Number.isFinite(number))
      onChange(Math.min(max, Math.max(min, Math.round(number * 100) / 100)))
    setDraft(null)
  }
  function move(direction: number) {
    const current = draft?.trim() && Number.isFinite(Number(draft)) ? Number(draft) : value
    commit(String(current + direction * step))
  }
  const button =
    "flex h-9 w-8 shrink-0 items-center justify-center rounded hover:bg-accent disabled:opacity-30"
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center rounded-lg border border-input bg-background text-xs focus-within:ring-1 focus-within:ring-primary">
        <button
          className={button}
          aria-label={t("number.decrease", { label })}
          disabled={value <= min && draft === null}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => move(-1)}
        >
          <Minus size={13} />
        </button>
        <input
          className="h-9 w-14 bg-transparent text-center outline-none"
          aria-label={label}
          inputMode="decimal"
          role="spinbutton"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          value={draft ?? String(value)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit(e.currentTarget.value)
            }
            if (e.key === "Escape") setDraft(null)
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault()
              move(e.key === "ArrowUp" ? 1 : -1)
            }
          }}
        />
        <span className="text-muted-foreground">{unit}</span>
        <button
          className={button}
          aria-label={t("number.increase", { label })}
          disabled={value >= max && draft === null}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => move(1)}
        >
          <Plus size={13} />
        </button>
      </div>
      <button
        className={button}
        title={t("number.reset", { label })}
        aria-label={t("number.reset", { label })}
        disabled={value === defaultValue && draft === null}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setDraft(null)
          onChange(defaultValue)
        }}
      >
        <RotateCcw size={13} />
      </button>
    </div>
  )
}
