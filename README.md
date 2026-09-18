# Beats / Steps 赔率工作台

仓库包含 Beats 触碰板与 Steps 方向阶梯的完整实现。网站使用 Gate 的 BTC／ETH 现货和 XAU_USDT 黄金永续成交数据，提供动态赔率、历史回放、实时行情、模拟接单与结算记录。

正式文字作答见 [正式提交答案](正式提交答案.md)。

## 在线网站

- 网站：<https://beats-steps-69-5-7-187.sslip.io>
- Beats：<https://beats-steps-69-5-7-187.sslip.io/beats>
- Steps：<https://beats-steps-69-5-7-187.sslip.io/steps>

## 本地运行

需要 Node.js 24 及 npm。在仓库根目录执行：

```bash
cd site
npm ci
mkdir -p ../.run
PAPER_LEDGER_PATH=../.run/paper-ledger.sqlite npm run service
```

另开一个终端：

```bash
cd site
npm run dev
```

访问 <http://127.0.0.1:3000>。定价服务监听 `127.0.0.1:4318`，Next.js 将 `/api/lab/*` 转发给该服务。

## 验证

```bash
cd site
npm run typecheck
npm run lint
npm run build
```

## 数据与验证口径

- 正式答案中的预测误差和历史返还来自 Gate 的 BTC／ETH 现货与 XAU_USDT 黄金永续真实成交。诊断区间为 2026-09-15 至 09-18 00:00 UTC，每个标的检查 4,315 个报价时点。
- `site/public/data/research-summary.json` 是页面使用的摘要，`site/public/data/v5-diagnostic.json` 保存三标的、两种 Beats 结算口径的完整结果，`site/public/data/model-release.json` 保存模型库版本和 SHA-256。
- 文件名含 `synthetic` 的回放只用于检查“长时间无成交”和“持续同价成交”等边界规则，带有 `synthetic: true` 标记，不参与预测误差和历史返还计算。
- 这三天行情参与过方案研究，因此属于历史诊断，并非未见数据上的独立验证。完整逐笔原始历史因体积较大未放入提交仓库；仓库保留验证结果、模型库和用于网站展示的真实回放片段。

## 项目结构

- `site/app`：Next.js 页面和全局样式
- `site/components/lab`：Beats、Steps、行情回放与验证组件
- `site/lib/engine`：概率、校准、赔率与结算逻辑
- `site/service`：实时行情、回放、接单、账本和恢复服务
- `site/public/data`：网站使用的回放与验证数据
- `data/artifacts`：网站运行所需的模型库

该项目是模拟交易系统，不连接真实资金账户。线上服务使用免费 IP 子域名和自动 HTTPS 证书。
