import { translate, type MessageKey } from "@/i18n/runtime"
import { ipcError } from "./desktop"
const messages: Record<string, MessageKey> = {
  无效文献标识: "library.error.invalidId",
  论文库目录不能是符号链接: "library.error.linkedDirectory",
  论文库文件不能是链接: "library.error.linkedFile",
  "论文库由更新版本创建，请升级应用": "library.error.newerSchema",
  文献不存在: "library.error.missingPaper",
  "一次最多导入 200 篇": "library.error.batchLimit",
  无效文献标题: "library.error.invalidTitle",
  "无效 PDF": "library.error.invalidPdf",
  "没有 PDF 附件": "library.error.noAttachment",
  笔记内容过长: "library.error.longNote",
  论文会话不存在: "library.error.missingChat",
  未知阅读状态: "library.error.unknownState",
  状态过大: "library.error.largeState",
  未知论文库操作: "library.error.unknownAction",
  当前会话没有笔记写入权限: "library.error.readOnlyNote",
  "无效 PDF 指纹": "library.error.invalidHash",
  无效论文文件映射: "library.error.invalidMapping",
  "请输入不含账号密码的 HTTPS PDF 链接": "library.error.https",
  "PDF 超过 100 MB": "library.error.tooLarge",
  下载内容为空: "library.error.empty",
  "链接返回的不是 PDF；请使用 PDF 直链，或输入 DOI 导入文献信息": "library.error.notPdf",
  "PDF 链接重定向次数过多": "library.error.redirects",
  "Paper download cancelled": "library.error.cancelled",
  "Library transaction rollback failed": "library.error.rollback",
  "下载内容不是 PDF": "library.error.downloadNotPdf",
}
const prefixes: [string, MessageKey][] = [
  ["PDF 下载失败：HTTP ", "library.error.http"],
  ["已跳过链接：", "library.error.skippedLink"],
  ["PDF 超过 100 MB：", "library.error.largeFile"],
  ["不是有效 PDF：", "library.error.invalidFile"],
  ["重复 PDF 未重复收录：", "library.error.duplicateFile"],
  ["Library rollback conflict: ", "library.error.rollbackConflict"],
]
export function libraryMessage(error: unknown): string {
  const message = ipcError(error).message
  const key = Object.hasOwn(messages, message) ? messages[message] : undefined
  if (key) return translate(key)
  for (const [prefix, key] of prefixes)
    if (message.startsWith(prefix)) return translate(key, { detail: message.slice(prefix.length) })
  return message
}
