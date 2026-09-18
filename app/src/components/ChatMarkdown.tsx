import { memo } from "react"
import { MarkdownCodeBlock } from "./MarkdownCodeBlock"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import rehypeHighlight from "rehype-highlight"
import "katex/dist/katex.min.css"
import "./chat-markdown.css"
import { rehypeCallouts } from "@/lib/rehypeCallouts"
import { useT } from "@/i18n/useT"

export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  onSource,
}: {
  text: string
  onSource?: (url: string) => void
}) {
  const { t } = useT()
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeKatex, { trust: false, throwOnError: false, strict: "ignore", maxExpand: 1000 }],
          rehypeCallouts,
          [rehypeHighlight, { detect: false }],
        ]}
        urlTransform={(url) =>
          onSource && url.startsWith("envoi-paper:")
            ? url
            : /^(https?:\/\/|mailto:)/i.test(url)
              ? url
              : ""
        }
        components={{
          a: ({ href, children }) =>
            href?.startsWith("envoi-paper:") && onSource ? (
              <button className="text-primary underline" onClick={() => onSource(href)}>
                {children}
              </button>
            ) : href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => (
            <span className="text-muted-foreground">
              [{t("common.image")}
              {alt ? t("common.imageAlt", { alt }) : ""}]
            </span>
          ),
          table: ({ children }) => (
            <div
              className="chat-table-scroll"
              tabIndex={0}
              role="region"
              aria-label={t("chat.tableScroll")}
            >
              <table>{children}</table>
            </div>
          ),
          pre: MarkdownCodeBlock,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
