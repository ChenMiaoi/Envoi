import { HighlightStyle } from "@codemirror/language"
import { tags } from "@lezer/highlight"

/* 代码语法着色：token 颜色走主题色相槽（index.css 每个主题都定义全套 --hue-*），
   CodeEditor 与 MarkdownEditor 代码块共用，保证深浅主题下对比度一致。
   映射参考 godot-vscode-theme：关键字/预处理鲑鱼红、字符串淡黄、数字薄荷绿、
   注释灰绿、函数与成员亮蓝、类型青色；普通变量不着色（跟随前景色）。 */
export const codeHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.meta, tags.labelName], color: "hsl(var(--hue-red))" },
  { tag: [tags.string, tags.special(tags.string)], color: "hsl(var(--hue-yellow))" },
  { tag: [tags.number, tags.bool, tags.atom], color: "hsl(var(--hue-green))" },
  { tag: tags.comment, color: "hsl(var(--hue-sage))" },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.propertyName,
      tags.attributeName,
    ],
    color: "hsl(var(--hue-blue))",
  },
  {
    tag: [tags.typeName, tags.className, tags.standard(tags.variableName), tags.namespace],
    color: "hsl(var(--hue-cyan))",
  },
])
