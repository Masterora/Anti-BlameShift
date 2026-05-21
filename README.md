# Anti-BlameShift

暗色主题的项目设计标注工具，用于在设计图上标注交互、接口和备注，支持通过隐藏关联 Tag 在多张图片和多个标注之间跳转，并围绕项目权限与日志做协作准备。

## 技术栈

- 前端：Vite + React + TypeScript
- 后端：Fastify + TypeScript
- 数据库：SQLite，运行时文件默认在 `data/app.sqlite`
- 数据访问：Drizzle ORM + `better-sqlite3`
- 图标：Lucide React
- 样式：原生 CSS，暗色主题
- 部署：Docker 单服务，后端托管前端静态资源

账号、项目、权限、接口和日志已经由后端 API 持久化到 SQLite。浏览器本地只保存当前页面、选中项目和选中图片等 UI 状态。

## 核心功能

- 设计图导入、图片列表、区域标注、文字标注与撤回。
- Swagger JSON 导入、接口列表、中文/路径/字段搜索。
- 关联 Tag 跳转，支持跨图片、多标注选择跳转。
- 数据流记录，支持记录来源、去向、关联接口、字段映射、条件、转换逻辑和备注。
- 数据流辅助检查，支持从接口带入字段、提示未映射必填字段。
- 项目权限和项目日志。

## 项目结构

```text
.
├── apps/
│   ├── api/
│   │   ├── src/server.ts       # Fastify API、认证、静态资源托管
│   │   ├── src/db/index.ts     # SQLite 初始化、查询与持久化
│   │   └── src/db/schema.ts    # Drizzle 表结构
│   └── web/
│       ├── src/App.tsx         # 页面、权限、标注、接口搜索等核心交互
│       ├── src/types.ts        # 前端业务类型
│       ├── src/i18n/zh-CN.ts   # 文案库，后续用于语言切换
│       ├── src/theme/dark.ts   # 主题变量，后续用于主题切换
│       └── src/config/shortcuts.ts
├── data/                       # 本地 SQLite 数据目录，已忽略提交
├── Dockerfile
├── package.json
└── README.md
```

## 权限类型

- 管理者
- 编辑项目
- 编辑图片
- 编辑接口
- 编辑内容

内置超级用户：

```text
账号：root
密码：qweasd123
```

密码输入支持显示/隐藏；前端只向后端提交密码哈希，不保存用户密码明文。

创建项目的用户默认成为该项目管理者；开发者不会默认获得项目权限，需要由管理者在权限页分配。

## 本地开发

```bash
npm install
npm run dev
```

访问：

```text
http://localhost:5173
```

开发时 Vite 会把 `/api` 代理到后端：

```text
http://localhost:8787
```

## 检查与构建

```bash
npm run typecheck
npm run build
```

## Docker

```bash
docker build -t anti-blameshift .
docker run --rm -p 8787:8787 -v "$PWD/data:/app/data" anti-blameshift
```

访问：

```text
http://localhost:8787
```

## Vercel + Render 部署

推荐把前端部署到 Vercel，把后端 Docker 服务部署到 Render。SQLite 数据文件保存在 Render 的持久磁盘中。

### Render 后端

创建 Render Web Service 时选择 Docker，仓库根目录使用当前 `Dockerfile`。

需要配置持久磁盘：

```text
Mount Path: /app/data
```

建议环境变量：

```text
HOST=0.0.0.0
DATA_DIR=/app/data
SERVE_WEB=false
WEB_ORIGINS=https://your-web.vercel.app
COOKIE_SECRET=replace-with-a-long-random-secret
COOKIE_SAME_SITE=none
COOKIE_SECURE=true
```

部署完成后，Render 会提供类似下面的后端地址：

```text
https://your-api.onrender.com
```

### Vercel 前端

Vercel 项目的 Root Directory 选择：

```text
apps/web
```

`apps/web/vercel.json` 已配置 Vite 构建命令和输出目录。

需要在 Vercel 配置环境变量：

```text
VITE_API_BASE_URL=https://your-api.onrender.com
```

部署完成后，把 Vercel 生成的前端域名填回 Render 的 `WEB_ORIGINS`。如果有多个前端域名，用英文逗号分隔：

```text
WEB_ORIGINS=https://your-web.vercel.app,https://your-domain.com
```

### 注意事项

- Render 必须配置持久磁盘，否则 SQLite 文件会随实例重建丢失。
- 跨域登录依赖 Cookie，生产环境需要 HTTPS、`SameSite=None` 和 `Secure=true`。
- 当前图片仍保存在 SQLite 数据中，适合第一版使用；后续图片量变大时建议迁移到对象存储。
