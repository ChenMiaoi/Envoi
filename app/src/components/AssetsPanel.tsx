import { isWritingPath } from "@/lib/projectFiles";
import { useEffect, useMemo, useRef, useState } from "react";
import { useProject } from "@/project/context";
import { assetMatches, findAssetUses } from "@/lib/assets";
import type { collectPaper, SourceLocation } from "@/lib/paperSources";
interface Asset { path: string; url?: string; kind: string; text?: string }
export function AssetsPanel({ paper, onLocate }: { paper: ReturnType<typeof collectPaper>; onLocate: (location: SourceLocation) => void }) {
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
      setNotice(`${asset.path}：${found[index].path} 第 ${index + 1}/${found.length} 处`);
    } else { setSelected(asset); setNotice(asset.url || asset.text !== undefined ? "" : "项目模型只有文件名，当前没有可读取的实体文件。"); }
  };
  return <div className="space-y-2 text-[11px]">
    <button onClick={() => fileRef.current?.click()} className="rounded border border-border px-2 py-1 hover:bg-secondary">打开本地素材</button>
    <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.csv" className="hidden" aria-label="选择本地素材" onChange={async (event) => {
      const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!["png", "jpg", "jpeg", "webp", "gif", "pdf", "csv"].includes(extension)) { setNotice("仅支持图片、PDF 和 CSV。"); return; }
      try {
        const text = extension === "csv" ? await file.text() : undefined;
        const url = URL.createObjectURL(file); urls.current.push(url);
        const asset = { path: `assets/${file.name}`, url, kind: extension === "csv" ? "csv" : extension === "pdf" ? "pdf" : "image", text };
        setAssets((previous) => [...previous.filter((item) => item.path !== asset.path), asset]); setSelected(asset); setNotice("");
      } catch (error) { setNotice(`读取失败：${(error as Error).message}`); }
    }} />
    <p className="text-muted-foreground">范围：主论文可达章节；识别 includegraphics、includepdf、pgfplotstableread、csvreader 和 addplot table。未使用指在这些语法中未检测到；不解析宏或 graphicspath。</p>
    {!!paper.missing.length && <p className="text-amber-300">统计不完整：{paper.missing.join("；")}</p>}
    <p role="status" className="break-words text-primary">{notice}</p>
    {[true, false].map((used) => <section key={String(used)} className="space-y-1.5">
      <h3 className="pt-2 text-muted-foreground">{used ? "已使用" : "未使用（支持语法内）"}</h3>
      {assets.filter((asset) => !!positions(asset).length === used).map((asset) => <button key={asset.path} onClick={() => open(asset)} className="block w-full rounded-lg border border-border bg-background p-2.5 text-left hover:border-primary/40">
        <span className="block break-all">{asset.path}</span>
        <span className="text-muted-foreground">{used ? `定位使用（${positions(asset).length} 处）` : asset.url || asset.text !== undefined ? "未使用 · 点击预览" : "未使用 · 文件内容不可用"}</span>
      </button>)}
    </section>)}
    {selected && <div className="space-y-2 rounded border border-border p-2">
      <div className="flex justify-between gap-2"><span className="break-all">{selected.path}</span><button onClick={() => setSelected(null)}>关闭</button></div>
      {!selected.url && selected.kind !== "csv" ? <p>没有实体文件可预览，可用“打开本地素材”提供文件。</p> : selected.kind === "pdf" ? <iframe title={selected.path} src={selected.url} className="h-80 w-full border-0" /> : selected.kind === "csv" ? <pre className="max-h-80 overflow-auto whitespace-pre text-[10px]">{selected.text}</pre> : <img src={selected.url} alt={selected.path} className="h-auto w-full" onError={() => setNotice("图片解码失败，请检查文件内容。")} />}
    </div>}
    {uses.filter((use) => !assets.some((asset) => assetMatches(asset.path, use))).map((use, index) => <button key={index} className="block break-all text-left text-amber-300" onClick={() => onLocate(use)}>未找到实体素材：{use.target} · 定位</button>)}
  </div>;
}
