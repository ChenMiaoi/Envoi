type Tok = { text: string; cls: string };

export function tokenizeLatex(src: string): Tok[] {
  const re = /(%[^\n]*)|(\\[a-zA-Z@]+\*?|\\.)|(\$[^$\n]*\$)|([{}[\]])/g;
  const toks: Tok[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) toks.push({ text: src.slice(last, m.index), cls: "" });
    if (m[1]) toks.push({ text: m[1], cls: "text-[#7a8a6a]" }); // 注释
    else if (m[2]) toks.push({ text: m[2], cls: "text-[#e5e08e]" }); // 命令
    else if (m[3]) toks.push({ text: m[3], cls: "text-[#d8a26e]" }); // 行内公式
    else if (m[4]) toks.push({ text: m[4], cls: "text-[#8ab8e0]" }); // 括号
    last = re.lastIndex;
  }
  if (last < src.length) toks.push({ text: src.slice(last), cls: "" });
  return toks;
}

