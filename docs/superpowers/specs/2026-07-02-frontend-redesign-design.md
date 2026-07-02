# 前端 UI 重设计规范

> 日期：2026-07-02 | 状态：已确认 | 范围：前端 only（不碰后端）

## 一、目标

将现有基于 shadcn/ui 默认主题的前端，升级为**专业企业级**视觉风格，增强安全审计平台的信任感与专业度。

## 二、设计决策汇总

| 维度 | 决定 |
|------|------|
| 风格 | 专业企业级 + 明暗切换 + 全域毛玻璃 |
| 主色 | 靛蓝/紫蓝系（Indigo） |
| 导航 | 混合式（侧边栏主导航 + 顶部栏用户/设置/主题） |
| 毛玻璃 | 侧边栏、Header、卡片、弹窗全部 |
| 字体 | Inter（正文）+ JetBrains Mono（代码） |
| 首页 | 统计看板 + 最近项目 + 快捷操作 |
| 范围 | 首批 6 个核心页面，第二批 7 个页面 |

## 三、设计系统

### 3.1 色彩体系

基于靛蓝主色（`243 75% 59%`），完整重定义 Light/Dark 两套 CSS 变量。

**Light Mode：**

| Token | HSL | 用途 |
|-------|-----|------|
| `--background` | `240 10% 98%` | 页面底色（微灰，护眼） |
| `--foreground` | `240 10% 3.9%` | 主文字 |
| `--card` | `0 0% 100%` | 卡片背景（纯白，与底色区分） |
| `--primary` | `243 75% 59%` | 靛蓝主色 |
| `--primary-foreground` | `0 0% 100%` | 主色上文字 |
| `--secondary` | `240 4.8% 95%` | 次级背景 |
| `--muted` | `240 4.8% 95%` | 弱化背景 |
| `--muted-foreground` | `240 4% 46%` | 次要文字 |
| `--border` | `240 6% 90%` | 边框 |
| `--ring` | `243 75% 59%` | 焦点环 |
| `--destructive` | `0 72% 51%` | 危险/严重漏洞 |
| `--radius` | `0.625rem` | 全局圆角 |

**Dark Mode：**

| Token | HSL |
|-------|-----|
| `--background` | `240 10% 3.9%` |
| `--foreground` | `0 0% 95%` |
| `--card` | `240 8% 8%` |
| `--primary` | `243 75% 68%` |
| `--border` | `240 4% 20%` |
| `--muted` | `240 4% 14%` |

**语义扩展色（漏洞等级/状态）：**

| Token | Light HSL | Dark HSL | 用途 |
|-------|-----------|----------|------|
| `--severity-critical` | `0 72% 51%` | `0 72% 55%` | 严重 |
| `--severity-high` | `25 95% 53%` | `25 95% 58%` | 高危 |
| `--severity-medium` | `45 93% 47%` | `45 93% 52%` | 中危 |
| `--severity-low` | `200 80% 50%` | `200 80% 55%` | 低危 |
| `--severity-info` | `240 5% 50%` | `240 5% 55%` | 信息 |
| `--success` | `142 72% 40%` | `142 72% 45%` | 成功 |
| `--warning` | `38 92% 50%` | `38 92% 55%` | 警告 |

### 3.2 字体

```css
fontFamily: {
  sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
  mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
}
```

引入：Google Fonts（Inter: 400/500/600/700 + JetBrains Mono: 400/500），中文 fallback 到系统默认。

### 3.3 毛玻璃 Recipe

三个颗粒度：

| 级别 | 类名 | blur | 透明度 | 场景 |
|------|------|------|--------|------|
| 强 | `.glass-surface` | `blur(16px)` | `0.72` | 侧边栏、Header |
| 中 | `.glass-card` | `blur(10px)` | `0.65` | 卡片 |
| 轻 | `.glass-popover` | `blur(8px)` | `0.82` | 弹窗、下拉 |

均带 `saturate(120-140%)` + 半透明边框 + `shadow`。

### 3.4 间距与圆角

| Token | 值 | 用途 |
|-------|-----|------|
| `--radius` | `0.625rem`（10px） | 卡片、按钮、输入 |
| `--radius-lg` | `0.75rem`（12px） | 大卡片、对话框 |
| `--radius-sm` | `0.375rem`（6px） | 徽章、标签 |
| 页面 padding | `py-6` | 容器内边距 |
| 卡片 padding | `p-5` | 卡片内边距 |

## 四、布局框架

### 4.1 三区结构

```
┌──────────────────────────────────────────┐
│  TopBar (h-14, glass-surface, sticky)    │
│  [☰] [Logo]  ···  [🌙] [👤]           │
├────────┬─────────────────────────────────┤
│Sidebar │  Content Area                   │
│ w-56   │  container max-w-7xl py-6       │
│        │                                 │
├────────┴─────────────────────────────────┤
└──────────────────────────────────────────┘
```

### 4.2 TopBar

- 高度 `h-14`（56px），`sticky top-0 z-50`
- 背景 `glass-surface`
- 左侧：折叠按钮 + Logo "CodeSec Audit"
- 右侧：主题切换按钮 + 用户头像下拉菜单
- 用户头像下拉：用户名、角色、设置链接、登出

### 4.3 Sidebar

- 展开 `w-56`（224px），折叠 `w-16`（64px 仅图标）
- 定位 `fixed left-0 top-14 bottom-0 z-40`
- 背景 `glass-surface`
- 菜单结构：

```
📊 总览           → /
📁 项目列表        → /projects
  └── 当前项目      → /projects/:id（面包屑上下文）
🛡️ 管理（仅 admin）
  ├── 用户管理      → /admin/users
  └── 系统配置      → /admin/config
⚙️ 设置           → /me
```

- 活跃项：靛蓝高亮 + 左侧 3px 竖线指示器 + `bg-primary/10`
- 折叠态：仅图标 + hover Tooltip
- 折叠状态持久化到 `localStorage`
- 响应式：`<1024px` 默认图标模式，`<768px` overlay 抽屉

### 4.4 内容区

- `ml-56`（展开）/ `ml-16`（折叠），`transition-[margin] duration-300`
- `min-h-[calc(100vh-3.5rem)]`

## 五、组件改造清单

### 5.1 新增 shadcn/ui 组件

通过 `npx shadcn@latest add` 添加：

| 组件 | 用途 |
|------|------|
| `card` | 卡片容器（替换手写 div） |
| `badge` | 状态/等级徽章 |
| `tabs` | 标签页导航 |
| `dialog` | 模态对话框 |
| `dropdown-menu` | 下拉菜单 |
| `avatar` | 用户头像 |
| `tooltip` | 折叠侧边栏提示 |
| `separator` | 分割线 |
| `skeleton` | 加载骨架屏 |
| `toast` / `sonner` | 通知提示（替换 alert） |
| `input` | 输入框 |
| `textarea` | 文本域 |
| `select` | 下拉选择 |
| `table` | 表格 |
| `scroll-area` | 自定义滚动条 |

### 5.2 新增业务组件

| 组件 | 文件 | 用途 |
|------|------|------|
| `Sidebar` | `components/Sidebar.tsx` | 侧边栏导航 |
| `TopBar` | `components/TopBar.tsx` | 顶部栏 |
| `AppLayout`（重写） | `components/AppLayout.tsx` | 三区布局壳 |
| `SeverityBadge` | `components/SeverityBadge.tsx` | 漏洞等级徽章（统一替代各处散落的 severityClass） |
| `StatusBadge` | `components/StatusBadge.tsx` | 扫描/任务状态徽章（统一替代各处散落的 statusClass） |
| `StatCard` | `components/StatCard.tsx` | 统计数字卡片 |
| `EmptyState` | `components/EmptyState.tsx` | 空状态占位（图标 + 文案 + 可选按钮） |
| `PageHeader` | `components/PageHeader.tsx` | 页面标题区（面包屑 + 标题 + 操作按钮行） |
| `ThemeToggle` | `components/ThemeToggle.tsx` | 明暗切换按钮 |

### 5.3 删除/重构的代码

- **全局 `index.css`**：完全替换为新的 CSS 变量体系
- **`tailwind.config.js`**：扩展 `colors` 语义色、`fontFamily`
- **重复函数**：删除各页面中重复的 `severityClass()` / `statusClass()`，统一用组件

## 六、首批页面（6 个）

按用户主流程排序：

| # | 页面 | 路由 | 关键改动 |
|---|------|------|----------|
| 1 | 登录页 | `/login` | 居中卡片 + 毛玻璃 + 品牌标语 + 靛蓝渐变背景 |
| 2 | 首页 Dashboard | `/` | 统计卡片行（项目数/扫描数/漏洞数/活跃度）+ 最近项目表格 + 快捷操作区 |
| 3 | 项目列表 | `/projects` | 卡片网格（替代纯表格）+ 搜索筛选 + 新建项目卡片 |
| 4 | 项目详情 | `/projects/:id` | Tabs 组件（替换手动 tab）+ 统计概览卡片 + 操作按钮组 |
| 5 | 扫描详情 | `/projects/:id/scans/:runId` | 进度条动画 + 日志终端风格 + WebSocket 状态指示器 |
| 6 | 报告页 | `/projects/:id/scans/:runId/report` | 侧边栏章节导航优化 + 折叠章节卡片 + 打印友好 |

### 6.1 登录页详细

- 全屏居中布局，背景使用靛蓝渐变 + 几何装饰（纯 CSS）
- 登录卡片：`glass-card` + `w-[400px]`
- 品牌区：Logo + "CodeSec Audit" + 标语 "AI 驱动的代码安全审计平台"
- 表单：Input 组件 + 靛蓝 Button + 错误提示区
- 底部：授权声明小字（保持现有安全合规要求）

### 6.2 Dashboard 详细

```
┌──────────────────────────────────────────┐
│  PageHeader: "总览" + 日期               │
├──────────┬──────────┬──────────┬─────────┤
│ StatCard │ StatCard │ StatCard │ StatCard│
│ 项目总数  │ 扫描次数  │ 漏洞发现  │ 本月活跃  │
├──────────┴──────────┴──────────┴─────────┤
│  最近项目 (Table/Card List)              │
│  ┌────────────────────────────────────┐  │
│  │ 项目名  │ 最后扫描  │ 漏洞数 │ 状态│  │
│  ├────────────────────────────────────┤  │
│  │ ...                                │  │
│  └────────────────────────────────────┘  │
├──────────────────────────────────────────┤
│  快捷操作 (3 个卡片按钮)                  │
│  [新建项目] [上传代码] [触发扫描]          │
└──────────────────────────────────────────┘
```

### 6.3 项目列表详细

- 顶部：PageHeader + 搜索框 + "新建项目" 按钮
- 项目展示：卡片网格（`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3`）
- 每个项目卡片：名称、描述（截断）、漏洞统计徽章、最后活动时间、点击进入详情
- 空状态：EmptyState 组件

### 6.4 项目详情详细

- PageHeader：面包屑 + 项目名 + [上传代码] [新建扫描] [对比] 按钮
- 统计概览行：4 个 StatCard（版本数/扫描数/漏洞数/成员数）
- Tabs 组件（Radix Tabs）：
  - 概览（基本信息 + 描述编辑）
  - 扫描历史（表格）
  - 版本管理（列表）
  - 成员管理（现有 ProjectMembersSection）
  - 漏洞库（链接跳转）

### 6.5 扫描详情详细

- PageHeader：面包屑 + 扫描 ID + "使用 Skill vX.Y" 徽章 + 状态徽章
- 进度区：进度条 + 百分比 + 阶段名称（动画过渡）
- 日志区：暗色终端风格（`bg-gray-950 text-green-400 font-mono`），自动滚动
- 操作区：取消/重扫按钮
- WebSocket 连接状态指示器（绿点/红点）

### 6.6 报告页详细

- 两栏布局：左侧章节导航（`w-56` sticky）+ 右侧报告内容
- 章节导航：折叠式树形，当前章节高亮
- 报告内容：卡片式章节（每章一个 Card），可折叠
- 头部：Skill 版本信息 + 覆盖率徽章 + 导出按钮
- 导出按钮：Markdown / JSON 下拉菜单

## 七、第二批页面（7 个）

| # | 页面 | 关键改动 |
|---|------|----------|
| 7 | Trace 页 | 时间线卡片优化 |
| 8 | Diff 页 | 双栏对比卡片 |
| 9 | VulnLibrary | 表格 + 筛选器组件化 |
| 10 | VulnLibraryDetail | 折叠区 + 时间线 |
| 11 | Settings | 表单卡片 |
| 12 | admin/Users | 表格 + 角色徽章 |
| 13 | admin/Config | 分区卡片 + 验证状态指示器 |

## 八、实施阶段

| Phase | 内容 | 预估 |
|-------|------|------|
| Phase 1 | 基础设施（主题 CSS + shadcn 组件 + 布局框架 + 业务组件） | 1 轮 |
| Phase 2 | 首批 6 个页面逐个重构 | 1 轮 |
| Phase 3 | 第二批 7 个页面快速铺开 + 文档收尾 | 1 轮 |

每阶段完成后 `pnpm -r typecheck && pnpm -r test && pnpm lint` 门禁验证。

## 九、注意事项

- **只改前端**：不碰 `apps/api/`、`packages/shared/`、`dotnet-security-audit-skill/`
- **API 接口不变**：所有现有 HTTP 端点、WebSocket 协议保持兼容
- **现有功能不删**：所有已落地的业务功能完整保留，只换皮
- **测试保持通过**：web 端现有 43 个测试保持绿
- **commit 记录**：每阶段单独 commit，参照项目现有 `[Prefix] YYYY-MM-DD: 描述` 风格
- **文档更新**：改完后更新 CLAUDE.md 记录此次 UI 重设计
