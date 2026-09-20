# RISC-V 官方资料与 ASM 支持

资料获取日期：2026-09-21。文件原样保存，不修改官方 PDF/HTML/JSON；精确来源、版本、大小、SHA-256 和各 submodule 的提交见 [sources.json](sources.json)。

## 先读哪份

| 资料                                                   | 版本与用途                                                                                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| [非特权架构 PDF](riscv-unprivileged-ratified.pdf)      | **20260120 Official Release**。基础整数指令、原子、浮点、压缩、向量及各扩展                                                             |
| [特权架构 PDF](riscv-privileged-ratified.pdf)          | **20260120 Official Release**。M/S 模式、CSR、异常中断、地址转换、Hypervisor 等                                                         |
| [合并版 HTML](riscv-spec.html) / [PDF](riscv-spec.pdf) | **20260917 Intermediate Release**，来自官方 GitHub release；包括非特权、特权及 Profiles。便于搜索，但不能把其中所有内容都视为已批准规范 |
| [规范规则 JSON](norm-rules.json)                       | 同一中间版本的机器可读规则，适合检索规则 ID、定位规范要求和分析；不是模拟器或执行语义模型                                               |

三个 GitHub release 资产均已与上游 SHA-256 digest 核对。两卷正式 PDF 来自 RISC-V 官方 Ratified Specifications Library，其封面版本已核对，保存本地计算的 SHA-256；网站链接将来可能更新，不应只凭 URL 判断版本。

## 可检索源码

以下官方仓库作为固定提交的 Git submodule 保存，便于直接全文搜索，不需要从 PDF 猜测排版或复制 OCR 文本：

- [ISA 手册](../../vendor/riscv-isa-manual)：`src/unpriv/` 和 `src/priv/` 分别是非特权、特权 AsciiDoc 源码。重点可查 `src/priv/machine.adoc`、`supervisor.adoc`、`hypervisor.adoc`、`csrs.adoc`。
- [指令编码及 CSR](../../vendor/riscv-opcodes)：`extensions/`、`extensions/unratified/`、`csrs.csv` 和 `csrs32.csv`。它提供编码字段，不等价于 GNU 汇编语法；`$pseudo_op` 是编码别名，不能覆盖所有多指令伪指令展开。
- [汇编程序员手册](../../vendor/riscv-asm-manual)：`src/asm-manual.adoc`，说明寄存器 ABI 别名、伪指令、重定位、`.option`、`.insn` 等。
- [ELF psABI](../../vendor/riscv-elf-psabi-doc)：调用约定、寄存器用途、ELF 重定位、链接松弛和 DWARF。

初次获取源码：

```sh
git submodule update --init --depth 1 vendor/riscv-isa-manual vendor/riscv-opcodes vendor/riscv-asm-manual vendor/riscv-elf-psabi-doc
```

不要使用 `--remote` 来复现本次资料，仓库记录的提交才是固定版本。源码快照可能比正式 PDF 更新；引用时同时注明仓库提交或规范版本。

## Envoi ASM 插件

入口：**设置 → 扩展 → ASM（RISC-V）**。当前以 GNU 风格的 RISC-V 汇编为目标，识别 `.s`、`.S`、`.asm`、`.riscv`，提供独立图标。

- 内置高亮：基础与扩展指令、通用/浮点/向量寄存器、CSR、重定位、标签、指示符、预处理和注释。
- 内置补全和悬停：官方 opcodes 的指令、CSR 及来源链接；未批准条目标记为 `UNRATIFIED`。编码字段明确标注为 encoding fields，不能当作汇编操作数模板。CSR 编码提示不代表运行时一定有访问权限。
- F12 或 Ctrl/Cmd+点击：本文件标签、数字局部标签 `1f/1b`、`.equ/.set` 符号、宏和 `#define` 定义。不会伪造跨文件或条件汇编后的精确符号解析。
- 保存时内置保守格式化：只规范已知指令的缩进和指令后空白。保留标签、操作数、字符串、宏体、续行、块注释、未知指令及换行约定；不展开伪指令或更改指令大小写。
- Clang 草稿检查：配置 `-march`、ABI、包含目录和宏；缺省为 `rv64gc/lp64d`。`.S` 使用 `assembler-with-cpp`，其他后缀使用纯汇编。对象文件仅写入临时目录，诊断对应当前草稿；头文件使用磁盘内容。Clang 必须包含 RISC-V 目标支持，可在扩展页选择已有可执行文件。

工程参数保存于 `.envoi/asm.json`；修改后重新打开编辑器。索引不按 `-march` 隐藏条目，目标可用性由所选汇编器检查。新指令的支持取决于 Clang 版本；这里不执行汇编代码、不仿真、不链接，也不验证运行时特权切换、内存模型或硬件行为。

### 可选 asm-lsp

扩展页可选择已有 `asm-lsp`；官方预编译安装入口仅在 Linux x64、macOS x64/ARM64 出现。Windows 没有上游预编译包，基本编辑能力仍可直接使用；Windows 用户也可在 WSL 中自行安装。

“创建可选 asm-lsp 配置”会新增 `.asm-lsp.toml`，选择 `riscv/gas` 并禁用它默认调用宿主 GCC/Clang 的诊断，避免错误架构和重复诊断。已有文件会触发保存冲突并保留，不会覆盖。只有项目存在该配置时 Envoi 才尝试启动外部服务；上游还要求 Git 项目根，请参阅 [asm-lsp README](https://github.com/bergercookie/asm-lsp)。使用已有配置时，须自行确认其 ISA、编译器及诊断选项。

内置功能可离线使用。SSH/WSL 的格式化和 Clang 检查通过现有工作区接口在远端执行，使用远端工具；本地工具路径不会传到远端。远端工具安装和路径管理沿用现有支持边界。其他 CPU 架构尚不承诺与 RISC-V 同等支持。

## 更新与许可

正常构建使用已提交的 `app/shared/riscv/opcodes.json`，无需联网或初始化文档 submodule。更新 opcode submodule 后运行：

```sh
node app/scripts/generate-riscv-reference.mjs
npm run format
```

同时更新 `sources.json` 的提交信息并运行测试；不要无意覆盖固定 PDF 快照。官方 ISA/汇编/psABI 文档的许可证以各仓库 `LICENSE` 为准；本目录 ISA 资料按 [CC BY 4.0](LICENSE) 归属 RISC-V International 及原作者。opcode 派生索引附带 [上游 BSD 许可证](../../app/shared/riscv/LICENSE)，并记录生成所用提交。文件图标沿用 Material Icon Theme 的 MIT 许可。
