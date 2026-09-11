<div align="center">

<img src="app/public/favicon.svg" width="72" alt="Envoi 标志" />

# Envoi

**把想法写成论文，把实验留在身边。**

一个连接阅读、写作与实验的本地科研工作区。

[![CI](https://github.com/ChenMiaoi/Envoi/actions/workflows/ci.yml/badge.svg)](https://github.com/ChenMiaoi/Envoi/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ChenMiaoi/Envoi?color=d3c875)](https://github.com/ChenMiaoi/Envoi/releases/latest)
![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS-738c9f)

[English](README.md)

[下载安装](https://github.com/ChenMiaoi/Envoi/releases/latest) · [功能一览](#研究不止发生在正文里) · [从源码运行](#从源码运行) · [参与开发](CONTRIBUTING.md)

</div>

![Envoi 写作工作区：章节大纲、LaTeX 正文与 PDF 预览](docs/images/writing.jpg)

<p align="center"><sub>同一个工作区里，组织论文、修改正文、查看编译结果。</sub></p>

## 研究不止发生在正文里

一篇论文背后，还有读过的文献、尝试过的方法、生成图表的数据，以及后来被放弃的实验。

Envoi 希望把这些过程放回论文身边：**主工作区保留论文，独立工作区展开实验，保存的结果保留来源。** 阅读笔记、代码、数据和写作不必散落在互不相干的窗口与目录中。

| 阅读                                | 写作                           | 实验                               |
| :---------------------------------- | :----------------------------- | :--------------------------------- |
| PDF、文献与笔记放在项目中           | LaTeX 正文与 PDF 并排查看      | 用独立 Git 工作区尝试不同方案      |
| Markdown 实时预览，CSV/TSV 直接编辑 | 自动大纲、参考文献、素材和诊断 | 查看提交历史、文件变化与已保存结果 |
| 每篇文献保留自己的阅读位置和对话    | 本机编译，错误定位回正文       | 将结果带回主工作区，并保留来源信息 |

## 写作时，保持上下文

- **LaTeX 工作台**：章节大纲、参考文献与素材面板，配合 PDFLaTeX / XeLaTeX 编译及 PDF 预览。
- **多格式阅读与编辑**：PDF、图片、Markdown、CSV / TSV 和源代码，沿用项目原本的目录结构。
- **项目文献库**：导入 PDF / BibTeX，整理文献与笔记，保留笔记历史和阅读位置。
- **可选 AI 助手**：在项目与文献上下文中讨论、阅读和协助修改。使用前配置自己的模型服务；调用外部模型时，相关上下文会发送给所选服务商。

## 给实验一个独立的空间

新的想法不必覆盖当前论文。创建实验工作区，尝试修改，再把需要的结果带回来。

![Envoi 版本与实验工作区](docs/images/experiments.jpg)

文件树用颜色和标记呈现 Git 状态；版本与实验页面集中展示工作区、提交历史与保存的结果。论文的演进与实验的过程可以一起追踪。

## 熟悉的文件，自己的节奏

Envoi 直接使用本地项目文件。基础阅读与手工编辑可以在限制模式下进行；信任项目后，才启用编译、Git 和 AI 工具等执行能力。

字体、字号、行高、主题和快捷键都可以调整。需要排查问题时，可从设置页导出本地诊断日志。

> 截图来自 Envoi 的独立演示项目。示例论文与图表使用合成数据，用于展示工作流，不代表真实实验结果。

## 开始使用

从 [GitHub Releases](https://github.com/ChenMiaoi/Envoi/releases/latest) 下载适合系统的安装包。每个版本的发布页包含更新说明与文件校验值。

| 平台    | 安装包           |
| :------ | :--------------- |
| Windows | `.exe` 安装程序  |
| macOS   | `.dmg` 或 `.zip` |

打开应用后，可以选择自己的项目，或点击 **打开示例项目**，创建一份独立副本来体验写作与实验流程。

按需准备以下工具：

| 你想做什么         | 需要准备什么                                                |
| :----------------- | :---------------------------------------------------------- |
| 阅读和编辑文件     | Envoi 即可                                                  |
| 编译 LaTeX         | 本机 TeX 工具链，例如 TeX Live / MacTeX，包含项目需要的宏包 |
| 查看版本与管理实验 | Git                                                         |
| 实时 LaTeX 检查    | ChkTeX（可选）                                              |
| 使用 AI 助手       | 在设置中配置受支持的模型服务                                |

应用会检测本机工具；缺失时给出提示，不会自动安装。macOS 安装包目前未签名和公证。详细说明见 [桌面使用与信任模式](docs/DESKTOP.md)。

## 从源码运行

需要 **Node.js 24+** 和 npm。

```sh
git clone https://github.com/ChenMiaoi/Envoi.git
cd Envoi
npm run dev
```

首次运行 `dev` 或 `build` 时会自动安装 `app/` 依赖；已有依赖时不会重复安装。需要手动重新安装依赖时，再运行 `npm run setup`。开发模式会打开 Electron 桌面窗口。无需先配置 AI；编译和 Git 功能按上面的工具要求启用。

<details>
<summary><strong>开发命令与目录结构</strong></summary>

| 命令                   | 用途                             |
| :--------------------- | :------------------------------- |
| `npm run build`        | 类型检查与构建                   |
| `npm run lint`         | 静态检查                         |
| `npm test`             | 核心逻辑测试                     |
| `npm run ci:check`     | 与 CI 等价的完整检查             |
| `npm run test:desktop` | 桌面交互回归，先运行构建         |
| `npm run test:local`   | 本机 TeX、Git、ChkTeX 等工具检查 |
| `npm run test:ai`      | AI 集成与数据迁移检查            |
| `npm run package:win`  | 构建 Windows 安装包              |
| `npm run package:mac`  | 构建 macOS 安装包                |

```text
app/
  src/                 界面与交互
  electron/            桌面主进程与桥接
  server/              本机工具与数据服务
  scripts/             开发和验证工具
  tests/               测试
examples/demo/         示例论文、图表与合成数据
docs/                  使用、架构与发布文档
```

依赖锁文件位于 `app/package-lock.json`。完整开发规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。

</details>

## 文档与参与

[桌面使用](docs/DESKTOP.md) · [阅读与文件格式](docs/READER_AND_LIBRARY.md) · [项目文献库](docs/research-library.md) · [设置](docs/SETTINGS.md) · [发布流程](docs/RELEASE.md)

欢迎通过 [Issues](https://github.com/ChenMiaoi/Envoi/issues) 反馈问题。报告问题时，请附上应用版本、操作系统、复现步骤，以及不含私人内容的截图或日志。提交代码前请阅读 [贡献指南](CONTRIBUTING.md)。

## 许可证与致谢

Envoi 的原创代码以 [Apache License 2.0](LICENSE) 发布。第三方依赖、论文模板和其他随项目分发的材料遵循各自的许可证，详见 [THIRD_PARTY.md](THIRD_PARTY.md)。Envoi 名称与标志不随该许可证授予商标使用权。
