import { Children, isValidElement, type ReactNode } from "react"

export function MarkdownCodeBlock({ children }: { children?: ReactNode }) {
  const code = Children.toArray(children).find((child) => isValidElement(child))
  const className = isValidElement<{ className?: string }>(code) ? code.props.className : ""
  const language = /(?:^|\s)language-([^\s]+)/.exec(className ?? "")?.[1]
  return (
    <div className="markdown-codeblock">
      {language && <div className="markdown-codeblock-language">{language}</div>}
      <pre tabIndex={0} className="envoi-scrollbar">
        {children}
      </pre>
    </div>
  )
}
