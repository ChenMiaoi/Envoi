import { EditorView } from "@codemirror/view"

/* 编辑器静态外观:补全弹窗、悬停文档、诊断、行号槽、括号配对等。
   颜色全部引用主题 CSS 变量,深浅主题自动适配;字体/字号等用户偏好
   仍在 CodeEditor 的设置 compartment 里动态注入。
   补全图标做成 VSCode 风格的字母徽章:形状区分语义(类/函数/变量…),
   颜色沿用语法高亮的色相槽。 */
const iconBadge = {
  padding: "0",
  width: "17px",
  height: "17px",
  marginRight: "2px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "4px",
  fontSize: "10px",
  fontWeight: "700",
  lineHeight: "1",
  opacity: "1",
  flexShrink: "0",
}
const iconColor = (hue: string) => ({
  backgroundColor: `hsl(var(--hue-${hue}) / .16)`,
  color: `hsl(var(--hue-${hue}))`,
})

export const editorChrome = EditorView.theme({
  "&": { height: "100%", color: "hsl(var(--foreground))" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { padding: "12px 0" },
  ".cm-line": { padding: "0 16px" },
  ".cm-cursor": { borderLeftColor: "hsl(var(--primary))", borderLeftWidth: "2px" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    background: "hsl(var(--primary) / .2)",
  },
  ".cm-gutters": {
    background: "transparent",
    color: "hsl(var(--muted-foreground) / .55)",
    border: "none",
    borderRight: "1px solid hsl(var(--border) / .45)",
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 12px" },
  ".cm-activeLine": { background: "hsl(var(--foreground) / .045)", borderRadius: "4px" },
  ".cm-activeLineGutter": { background: "transparent", color: "hsl(var(--foreground))" },
  ".cm-matchingBracket": {
    backgroundColor: "hsl(var(--primary) / .16)",
    outline: "1px solid hsl(var(--primary) / .35)",
    borderRadius: "2px",
  },
  ".cm-nonmatchingBracket": {
    backgroundColor: "hsl(var(--hue-red) / .25)",
    outline: "1px solid hsl(var(--hue-red) / .5)",
  },

  /* 弹层通用:补全、悬停、诊断共用一个浮层外观。 */
  ".cm-tooltip": {
    backgroundColor: "hsl(var(--popover))",
    color: "hsl(var(--popover-foreground))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    boxShadow: "0 12px 32px hsl(0 0% 0% / .28), 0 2px 8px hsl(0 0% 0% / .16)",
    overflow: "hidden",
  },
  ".cm-tooltip pre": { margin: "0" },

  /* 补全列表:行内 flex,左侧徽章,右侧 muted detail。 */
  ".cm-tooltip-autocomplete > ul": {
    fontFamily: "inherit",
    maxHeight: "320px",
    padding: "4px",
  },
  ".cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "3px 8px",
    borderRadius: "5px",
    lineHeight: "1.5",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "hsl(var(--accent))",
    color: "hsl(var(--accent-foreground))",
  },
  ".cm-completionMatchedText": {
    color: "hsl(var(--primary))",
    fontWeight: "600",
    textDecoration: "none",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected] .cm-completionMatchedText": {
    color: "inherit",
  },
  ".cm-completionDetail": {
    marginLeft: "auto",
    paddingLeft: "18px",
    fontStyle: "normal",
    fontSize: ".85em",
    color: "hsl(var(--muted-foreground))",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "26em",
  },
  ".cm-completionInfo": {
    padding: "8px 12px",
    maxWidth: "380px",
    maxHeight: "320px",
    fontSize: "12px",
    lineHeight: "1.55",
    border: "none",
    borderLeft: "1px solid hsl(var(--border))",
    borderRadius: "0",
    whiteSpace: "pre-wrap",
    overflowY: "auto",
  },

  ".cm-completionIcon": iconBadge,
  ".cm-completionIcon-function:after": { content: "'ƒ'" },
  ".cm-completionIcon-method:after": { content: "'m'" },
  ".cm-completionIcon-class:after": { content: "'C'" },
  ".cm-completionIcon-interface:after": { content: "'I'" },
  ".cm-completionIcon-variable:after": { content: "'V'" },
  ".cm-completionIcon-property:after": { content: "'P'" },
  ".cm-completionIcon-constant:after": { content: "'c'" },
  ".cm-completionIcon-enum:after": { content: "'E'" },
  ".cm-completionIcon-keyword:after": { content: "'K'" },
  ".cm-completionIcon-namespace:after": { content: "'N'" },
  ".cm-completionIcon-type:after": { content: "'T'" },
  ".cm-completionIcon-text:after": { content: "'a'" },
  ".cm-completionIcon-function, .cm-completionIcon-method": iconColor("violet"),
  ".cm-completionIcon-class, .cm-completionIcon-interface, .cm-completionIcon-enum, .cm-completionIcon-type":
    iconColor("cyan"),
  ".cm-completionIcon-variable, .cm-completionIcon-property": iconColor("blue"),
  ".cm-completionIcon-constant": iconColor("orange"),
  ".cm-completionIcon-keyword": iconColor("pink"),
  ".cm-completionIcon-namespace": iconColor("yellow"),
  ".cm-completionIcon-text": {
    backgroundColor: "hsl(var(--muted-foreground) / .14)",
    color: "hsl(var(--muted-foreground))",
  },

  /* 悬停文档:等宽字体渲染签名,限制尺寸可滚动。 */
  ".cm-hover-doc": {
    maxWidth: "420px",
    maxHeight: "320px",
    overflowY: "auto",
    padding: "8px 12px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "11.5px",
    lineHeight: "1.55",
    whiteSpace: "pre-wrap",
  },

  /* 诊断列表:按严重级别着色左边条。 */
  ".cm-tooltip .cm-diagnostic": {
    padding: "4px 10px",
    fontSize: "12px",
    lineHeight: "1.5",
  },
  ".cm-diagnostic + .cm-diagnostic": { borderTop: "1px solid hsl(var(--border) / .6)" },
  ".cm-diagnostic-error": { borderLeft: "3px solid hsl(var(--hue-red))" },
  ".cm-diagnostic-warning": { borderLeft: "3px solid hsl(var(--hue-yellow))" },
  ".cm-diagnostic-info": { borderLeft: "3px solid hsl(var(--hue-blue))" },
  ".cm-diagnostic-hint": { borderLeft: "3px solid hsl(var(--muted-foreground))" },
})
