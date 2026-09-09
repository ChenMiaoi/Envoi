import { translate } from "@/i18n/runtime"
export interface PaperTemplate {
  id: string
  name: string
  category: "通用" | "会议" | "期刊"
  family: string
  venue?: string
  year?: number
  version: string
  source: string
  license: string
  main: string
  style: string
}
const title = String.raw`\title{Paper Title}
\author{Author Name}`
const start = String.raw`\begin{document}
\maketitle
\begin{abstract}
Describe the problem, method, and findings of your paper here.
\end{abstract}`
const body = String.raw`\input{chapters/introduction}
\section{Method}
Describe your method and implementation.
\section{Evaluation}
Describe the experimental setup and report measured results.
\section{Conclusion}
Summarize the contribution and limitations.
`
function standard(preamble: string, opening: string, style: string) {
  return `${preamble}\n${opening}\n${body}\n\\bibliographystyle{${style}}\n\\bibliography{references}\n\\end{document}\n`
}
const acm = (option: string) =>
  standard(
    String.raw`\documentclass[${option},nonacm]{acmart}
\settopmatter{printacmref=false}
\title{Paper Title}
\author{Author Name}
\affiliation{\institution{Institution}\city{City}\country{Country}}
\email{author@example.org}`,
    start.replace("\\maketitle\n", "") + "\n\\maketitle",
    "ACM-Reference-Format",
  )
export const paperTemplates: PaperTemplate[] = [
  {
    id: "research",
    name: "研究项目 · 从 idea 开始",
    category: "通用",
    family: "研究笔记",
    version: "笔记、文献与实验",
    source: "",
    license: "",
    main: "",
    style: "research",
  },
  {
    id: "article",
    name: "通用 Article",
    category: "通用",
    family: "LaTeX article",
    version: "LaTeX 标准类",
    source: "https://www.latex-project.org/",
    license: "LPPL 1.3c（LaTeX base）",
    style: "article",
    main: standard(
      String.raw`\documentclass{article}
\usepackage{graphicx}
${title}`,
      start,
      "plain",
    ),
  },
  {
    id: "acm-conf",
    name: "ACM 会议 · sigconf",
    category: "会议",
    family: "ACM",
    version: "acmart · 本机 TeX Live 2026",
    source: "https://www.acm.org/publications/proceedings-template",
    license: "LPPL 1.3+",
    style: "acmart",
    main: acm("sigconf"),
  },
  {
    id: "acm-journal",
    name: "ACM 期刊 · acmsmall",
    category: "期刊",
    family: "ACM",
    version: "acmart · 本机 TeX Live 2026",
    source: "https://www.acm.org/publications/proceedings-template",
    license: "LPPL 1.3+",
    style: "acmart",
    main: acm("acmsmall"),
  },
  {
    id: "ieee-conf",
    name: "IEEE 会议",
    category: "会议",
    family: "IEEE",
    version: "IEEEtran 1.8b",
    source:
      "https://conferences.ieeeauthorcenter.ieee.org/write-your-paper/authoring-tools-and-templates/",
    license: "LPPL 1.3",
    style: "IEEEtran",
    main: standard(
      String.raw`\documentclass[conference]{IEEEtran}
\usepackage{graphicx}
\title{Paper Title}
\author{\IEEEauthorblockN{Author Name}\IEEEauthorblockA{Institution\\author@example.org}}`,
      start,
      "IEEEtran",
    ),
  },
  {
    id: "ieee-journal",
    name: "IEEE Transactions",
    category: "期刊",
    family: "IEEE",
    version: "IEEEtran 1.8b",
    source: "https://www.michaelshell.org/tex/ieeetran/",
    license: "LPPL 1.3",
    style: "IEEEtran",
    main: standard(
      String.raw`\documentclass[journal]{IEEEtran}
\usepackage{graphicx}
${title}`,
      start,
      "IEEEtran",
    ),
  },
  {
    id: "lncs",
    name: "Springer LNCS",
    category: "会议",
    family: "Springer",
    version: "llncs 2.26",
    source: "https://www.springer.com/gp/computer-science/lncs/forthcoming-proceedings",
    license: "CC BY 4.0 · Springer 1996–2025",
    style: "llncs",
    main: standard(
      String.raw`\documentclass[runningheads]{llncs}
\usepackage{graphicx}
${title}
\institute{Institution}`,
      start,
      "splncs04",
    ),
  },
  {
    id: "elsevier",
    name: "Elsevier 期刊 · elsarticle",
    category: "期刊",
    family: "Elsevier",
    version: "elsarticle · 本机 TeX Live 2026",
    source: "https://ctan.org/pkg/elsarticle",
    license: "LPPL 1.3+",
    style: "elsarticle",
    main: standard(
      String.raw`\documentclass[preprint,12pt]{elsarticle}
\usepackage{graphicx}`,
      String.raw`\begin{document}
\begin{frontmatter}
${title}
\begin{abstract}Describe the problem, method, and findings here.\end{abstract}
\end{frontmatter}`,
      "elsarticle-num",
    ),
  },
  {
    id: "pmlr",
    name: "PMLR 机器学习会议",
    category: "会议",
    family: "PMLR",
    version: "jmlr 1.30 · 单栏",
    source: "https://proceedings.mlr.press/faq.html",
    license: "LPPL 1.3+",
    style: "jmlr",
    main: standard(
      String.raw`\documentclass[pmlr]{jmlr}
\title{Paper Title}
\author{\Name{Author Name}\Email{author@example.org}\\\addr Institution}`,
      start,
      "plainnat",
    ).replace("\\bibliographystyle{plainnat}\n", ""),
  },
]
export function templateFiles(id: string, enableGit = true) {
  const template = paperTemplates.find((item) => item.id === id)
  if (!template) throw new Error(translate("template.unknown"))
  if (id === "research")
    return {
      ".gitignore": projectGitignore,
      ".envoi/project.json":
        JSON.stringify(
          {
            projectId: crypto.randomUUID(),
            main: "",
            settings: { version: 1, overrides: {} },
            buildDirectory: "build",
            git: {
              requested: enableGit,
              branch: "main",
              status: enableGit ? "pending-local-init" : "disabled",
            },
          },
          null,
          2,
        ) + "\n",
      "notes/research-plan.md":
        "# 研究计划\n\n## 问题与假设\n\n我们希望验证什么？什么结果会否定这个假设？\n\n## 相关工作\n\n在论文库导入文献，记录具体方法、证据与局限，并保留原文页码。\n\n## 可行性与差异\n\n哪些结论已有支持？哪些还需要实验？\n\n## 实验计划\n\n基线、变量、数据来源、指标和复现命令。真实实验在独立工作区进行。\n\n## 结果与决策\n\n在这里链接已归档的数据和实验记录，区分观察与推测。\n",
      "references.bib": "% Add verified references from the paper library.\n",
      "data/README.md": "Store source data here. Label synthetic data explicitly.\n",
    } as Record<string, string>
  return {
    "main.tex": template.main,
    ".gitignore": projectGitignore,
    ".envoi/project.json":
      JSON.stringify(
        {
          projectId: crypto.randomUUID(),
          main: "main.tex",
          settings: { version: 1, overrides: {} },
          buildDirectory: "build",
          git: {
            requested: enableGit,
            branch: "main",
            status: enableGit ? "pending-local-init" : "disabled",
          },
        },
        null,
        2,
      ) + "\n",
    "data/README.md": "Store source datasets here. Label synthetic data explicitly.\n",
    "build/README.md":
      "Generated PDF and compilation logs live here. This directory is ignored by Git.\n",
    "chapters/introduction.tex": String.raw`\section{Introduction}
Introduce your research question and context. Add verified related work to references.bib before citing it.
`,
    "references.bib": "% Add verified references from the paper library.\n",
    "TEMPLATE.md": `# ${template.name}\n\n官方样式：${template.style}\n来源：${template.source}\n样式许可：${template.license}\n\n本项目为 Envoi 编写的最小起稿骨架，调用原始官方样式，不修改或重新分发样式文件。需要本地 TeX 发行版提供相应类/字体/BibTeX样式。\n\n这是模板体系，不是某个会议年度的投稿保证。具体会议/期刊可能要求不同选项、匿名/版权信息、页数与格式。请按目标活动官方要求调整。ACM 骨架使用 nonacm 起稿选项，投稿前按官方要求替换。\n`,
  }
}

export const projectGitignore = `# Generated build outputs; input PDF figures under assets remain trackable
/build/
/output/
*.aux
*.log
*.bbl
*.blg
*.bcf
*.run.xml
*.fls
*.fdb_latexmk
*.synctex.gz
*.toc
*.out
*.lof
*.lot
*.nav
*.snm
*.xdv
*.dvi
*.vrb
*.synctex(busy)
.DS_Store
__pycache__/
*.pyc
.venv/
!/.envoi/
/.envoi/*
!/.envoi/project.json
`
