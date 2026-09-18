import { HighlightStyle } from "@codemirror/language"
import { tags } from "@lezer/highlight"

/* 代码语法着色:token 颜色走主题色相槽(index.css 每个主题都定义全套 --hue-*),
   CodeEditor 与 MarkdownEditor 代码块共用,保证深浅主题下对比度一致。
   配色分工:控制流关键字鲑鱼红、模块导入粉红、字符串淡黄、转义与正则橙色、
   数字与字面量薄荷绿、注释灰绿斜体、函数与成员亮蓝、类型青色、
   内建符号与装饰器紫罗兰、常量橙色;普通变量不着色(跟随前景色),
   标点与运算符压低明度,让有意义的 token 更突出。 */
export const codeHighlight = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.labelName],
    color: "hsl(var(--hue-red))",
  },
  { tag: tags.moduleKeyword, color: "hsl(var(--hue-pink))" },
  { tag: [tags.string, tags.character], color: "hsl(var(--hue-yellow))" },
  { tag: [tags.special(tags.string), tags.regexp], color: "hsl(var(--hue-orange))" },
  { tag: [tags.number, tags.bool, tags.atom], color: "hsl(var(--hue-green))" },
  { tag: tags.comment, color: "hsl(var(--hue-sage))", fontStyle: "italic" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.propertyName],
    color: "hsl(var(--hue-blue))",
  },
  { tag: tags.attributeName, color: "hsl(var(--hue-yellow))" },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    color: "hsl(var(--hue-cyan))",
  },
  {
    tag: [tags.standard(tags.variableName), tags.meta],
    color: "hsl(var(--hue-violet))",
  },
  {
    tag: [tags.self, tags.special(tags.variableName)],
    color: "hsl(var(--hue-violet))",
    fontStyle: "italic",
  },
  {
    tag: [tags.constant(tags.variableName), tags.constant(tags.className)],
    color: "hsl(var(--hue-orange))",
  },
  { tag: tags.operator, color: "hsl(var(--hue-orange) / .85)" },
  { tag: tags.punctuation, color: "hsl(var(--muted-foreground) / .7)" },
  { tag: tags.invalid, color: "hsl(var(--hue-red))", textDecoration: "underline wavy" },
])
