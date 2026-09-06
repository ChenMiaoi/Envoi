import {useT} from "@/i18n/useT";
import { isWritingPath } from "@/lib/projectFiles";
import { useEffect, useMemo, useRef, useState } from "react";
import { useProject } from "@/project/context";
import { assetMatches, findAssetUses } from "@/lib/assets";
import type { collectPaper, SourceLocation } from "@/lib/paperSources";
interface Asset { path: string; url?: string; kind: string; text?: string }
export function AssetsPanel({ paper, onLocate }: { paper: ReturnType<typeof collectPaper>; onLocate: (location: SourceLocation) => void }) {
  const { t } = useT();
  const { project } = useProject();
  const [localAssets, setAssets] = useState<Asset[]>([]);
  const assets: Asset[] = [...project.files.filter((file) => isWritingPath(file.path) && (["image", "pdf"].includes(file.kind) || /\.csv$/i.test(file.path))).map((file) => ({ path: file.path, url: file.url, kind: /\.csv$/i.test(file.path) ? "csv" : file.kind, text: file.text })), ...localAssets];
  const [selected, setSelected] = useState<Asset | null>(null);
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  const next = useRef<Record<string, number>>({});
  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  const uses = useMemo(() => findAssetUses(paper.files), [paper]);
  const positions = (asset: Asset) => uses.filter((use) => assetMatches(asset.path, use));
  const open = (asset: Asset) => {
    const found = positions(asset);
    if (found.length) {
      const index = (next.current[asset.path] ?? 0) % found.length;
      next.current[asset.path] = index + 1; onLocate(found[index]);
      setNotice(t('assets.useLocation',{asset:asset.path,file:found[index].path,index:index+1,total:found.length}));
    } else { setSelected(asset); setNotice(asset.url || asset.text !== undefined ? "" : t('assets.nameOnly')); }
  };
  return <div className="space-y-2 text-[11px]">
    <button onClick={() => fileRef.current?.click()} className="rounded border border-border px-2 py-1 hover:bg-secondary">{t('assets.openLocal')}</button>
    <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.csv" className="hidden" aria-label={t('assets.selectLocal')} onChange={async (event) => {
      const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!["png", "jpg", "jpeg", "webp", "gif", "pdf", "csv"].includes(extension)) { setNotice(t('assets.supportedTypes')); return; }
      try {
        const text = extension === "csv" ? await file.text() : undefined;
        const url = URL.createObjectURL(file); urls.current.push(url);
        const asset = { path: `assets/${file.name}`, url, kind: extension === "csv" ? "csv" : extension === "pdf" ? "pdf" : "image", text };
        setAssets((previous) => [...previous.filter((item) => item.path !== asset.path), asset]); setSelected(asset); setNotice("");
      } catch (error) { setNotice(t('assets.readFailed',{message:(error as Error).message})); }
    }} />
    <p className="text-muted-foreground">{t('assets.scope')}</p>
    {!!paper.missing.length && <p className="text-warning">{t('assets.statsIncomplete',{list:paper.missing.join("；")})}</p>}
    <p role="status" className="break-words text-primary">{notice}</p>
    {[true, false].map((used) => <section key={String(used)} className="space-y-1.5">
      <h3 className="pt-2 text-muted-foreground">{used ? t('assets.used') : t('assets.unusedInSyntax')}</h3>
      {assets.filter((asset) => !!positions(asset).length === used).map((asset) => <button key={asset.path} onClick={() => open(asset)} className="block w-full rounded-lg border border-border bg-background p-2.5 text-left hover:border-primary/40">
        <span className="block break-all">{asset.path}</span>
        <span className="text-muted-foreground">{used ? t('assets.locateUses',{count:positions(asset).length}) : asset.url || asset.text !== undefined ? t('assets.unusedPreview') : t('assets.unusedNoContent')}</span>
      </button>)}
    </section>)}
    {selected && <div className="space-y-2 rounded border border-border p-2">
      <div className="flex justify-between gap-2"><span className="break-all">{selected.path}</span><button onClick={() => setSelected(null)}>{t('common.close')}</button></div>
      {!selected.url && selected.kind !== "csv" ? <p>{t('assets.noPreviewFile')}</p> : selected.kind === "pdf" ? <iframe title={selected.path} src={selected.url} className="h-80 w-full border-0" /> : selected.kind === "csv" ? <pre className="max-h-80 overflow-auto whitespace-pre text-[10px]">{selected.text}</pre> : <img src={selected.url} alt={selected.path} className="h-auto w-full" onError={() => setNotice(t('assets.imageDecodeFailed'))} />}
    </div>}
    {uses.filter((use) => !assets.some((asset) => assetMatches(asset.path, use))).map((use, index) => <button key={index} className="block break-all text-left text-warning" onClick={() => onLocate(use)}>{t('assets.missingAsset',{target:use.target})}</button>)}
  </div>;
}
