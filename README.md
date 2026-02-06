# AI 产品经理·宠物鉴别实习模拟器

一个可直接试玩的 Web 教育游戏，目标是帮助用户在 30-45 分钟内走完一次完整 PM 闭环：立项 -> 洞察 -> 设计 -> 交付 -> 复盘。

## Play Now

上线后访问：

https://fridayxiao.github.io/PM_Intern_Mock/

说明：
- 默认就是可玩版本，不需要 API Key。
- AI 互动是可选增强；不可用时会自动降级为离线脚本模式，不影响通关。

## 核心体验

- 4 章主线 + 13 个任务。
- 重点包含真实工作流风格的 A/B 全流程：
  - `实验 Brief`
  - `埋点与口径校验`
  - `A/A + SRM 质检`
  - `分阶段放量`
  - `实验设计与结果解读`
  - `triage 与迭代闭环`
- 结算页可生成作品集摘要（可复制文本 + 导出 JSON）。

## 本地快速运行（可选）

仅前端：

```bash
npm install
npm run dev:client
```

打开 `http://localhost:5173`。

## 可选 AI 增强（不是必须）

如果你希望开启 AI 角色扮演与 AI 结果生成：

```bash
cp .env.example .env
npm run dev:server
```

`.env` 示例：

```env
DEEPSEEK_API_KEY=your_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
AI_SERVER_PORT=8787
```

然后再启动前端：

```bash
npm run dev:client
```

## GitHub Pages 自动部署

本仓库已包含工作流：`.github/workflows/pages.yml`

一次性设置：
1. 打开仓库 `Settings -> Pages`
2. `Build and deployment` 选择 `GitHub Actions`
3. 推送到 `main` 后会自动发布

发布成功后，Pages 会生成线上地址，填回 README 的 `Play Now` 链接即可传播。

## 内容模式

- `Public`（默认）：虚构化内容，适合公开传播。
- `Private`（本地）：可放本地私有素材，默认被 `.gitignore` 忽略。

## 校验与构建

```bash
npm run validate
npm run build
```

## License

建议公开仓库时使用 MIT License（如果你愿意，我可以直接补上 `LICENSE` 文件）。
