# Beats / Steps 赔率工作台

这是 Beats 触碰板与 Steps 方向阶梯的可运行网站。网站使用 Gate 的 BTC／ETH 现货和 XAU_USDT 黄金永续历史成交与实时成交，展示动态赔率、历史回放、模拟接单、结算记录和数据验证结果。

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

## 项目结构

- `site/app`：Next.js 页面和全局样式
- `site/components/lab`：Beats、Steps、行情回放和数据验证界面
- `site/lib/engine`：概率、校准、赔率与结算逻辑
- `site/service`：实时行情、回放、接单、账本和恢复服务
- `site/public/data`：网站使用的回放与验证数据
- `data/artifacts`：网站运行所需的模型库

该项目是模拟交易系统，不连接真实资金账户。线上服务使用免费 IP 子域名和自动 HTTPS 证书。

