const limit = 100_000_000
export async function downloadPaper(input, request = fetch) {
  let url = new URL(String(input))
  const signal = AbortSignal.timeout(30000)
  for (let redirect = 0; redirect <= 5; redirect++) {
    if (url.protocol !== "https:" || url.username || url.password)
      throw Error("请输入不含账号密码的 HTTPS PDF 链接")
    const response = await request(url, { redirect: "manual", signal })
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      await response.body?.cancel()
      url = new URL(response.headers.get("location"), url)
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw Error(`PDF 下载失败：HTTP ${response.status}`)
    }
    if (Number(response.headers.get("content-length")) > limit) {
      await response.body?.cancel()
      throw Error("PDF 超过 100 MB")
    }
    const chunks = []
    let size = 0
    if (!response.body) throw Error("下载内容为空")
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > limit) throw Error("PDF 超过 100 MB")
      chunks.push(chunk)
    }
    const bytes = Buffer.concat(chunks)
    if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
      throw Error("链接返回的不是 PDF；请使用 PDF 直链，或输入 DOI 导入文献信息")
    const basename = decodeURIComponent(url.pathname.split("/").pop() || "paper.pdf").replace(
      /[^\p{L}\p{N}_.-]/gu,
      "_",
    )
    return {
      name: basename.toLowerCase().endsWith(".pdf") ? basename : basename + ".pdf",
      base64: bytes.toString("base64"),
    }
  }
  throw Error("PDF 链接重定向次数过多")
}
