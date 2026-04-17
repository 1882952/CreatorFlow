# M01 Platform Shell

## Goal

建立 CreatorFlow 的最小可运行平台骨架，包括入口 HTML、全局布局、模块挂载区域、Hash 路由、事件总线和应用启动流程。这个模块完成后，页面应该已经具备“平台外壳”，但尚未接入真实任务数据和 ComfyUI 逻辑。

## Scope

- 平台级布局：侧边栏、内容区、底部状态栏
- 平台级样式令牌和基础组件样式
- 路由系统：`#/digital-human`、`#/settings`
- 模块注册与挂载机制
- 全局事件总线

## Out Of Scope

- ComfyUI API 调用
- 任务列表数据
- 上传交互
- 队列执行

## Target Files

- `creatorflow/index.html`
- `creatorflow/styles/variables.css`
- `creatorflow/styles/base.css`
- `creatorflow/styles/layout.css`
- `creatorflow/styles/components.css`
- `creatorflow/core/app.js`
- `creatorflow/core/router.js`
- `creatorflow/core/event-bus.js`
- `creatorflow/assets/logo.svg`

## UI Structure

页面结构建议固定为四层：

1. `#app-shell`
2. `#sidebar`
3. `#page-container`
4. `#statusbar`

内容区再拆成两个稳定挂载点：

- `#module-header-slot`
- `#module-content-slot`

这样数字人模块后续只需要操作模块区域，不需要重建整页 DOM。

## Core Contracts

### Router

```js
register(path, renderFn)
navigate(path)
start()
getCurrentPath()
```

约束：

- 路由只负责路径解析和回调触发，不负责业务状态。
- 默认进入 `#/digital-human`。
- 未注册路由一律回退到默认模块。

### Event Bus

```js
on(eventName, handler)
emit(eventName, payload)
off(eventName, handler)
```

推荐首批事件：

- `app:route-changed`
- `app:sidebar-toggle`
- `app:statusbar-update`
- `module:mount`
- `module:unmount`

## Implementation Steps

### Step 1: Build Static Shell

- 编写 `index.html`，只保留平台外壳和挂载点。
- 侧边栏先放固定项：数字人生成、设置。
- 底部状态栏先放占位信息，不提前接真实连接状态。

### Step 2: Establish Design Tokens

- 在 `variables.css` 中定义颜色、圆角、间距、阴影、动画时长。
- 保持变量命名稳定，后续模块样式只能消费变量，不直接写散落色值。

### Step 3: Implement App Layout

- 在 `layout.css` 中完成侧边栏折叠布局、主内容区伸缩和状态栏固定。
- 为后续监控面板预留足够宽度，不把主布局做成高度耦合的单页表单。

### Step 4: Add Router

- 使用 Hash 路由，不引入浏览器 History API。
- 路由切换时由 `app.js` 控制内容区挂载和卸载。

### Step 5: Add Module Bootstrap

- `app.js` 负责初始化 Router、EventBus、Storage、ComfyUIClient 的实例。
- 模块注册使用统一结构：

```js
registerModule({
  id: 'digital-human',
  route: '/digital-human',
  mount(container, context) {},
  unmount() {}
})
```

## Risks

- 如果页面 DOM 结构和模块内部结构耦合过深，后面切换执行态/编辑态时会反复推翻布局。
- 如果 `app.js` 直接写死业务细节，后续增加设置页和其他模块时会快速膨胀。

## Acceptance

- 打开页面可看到完整平台骨架。
- 侧边栏可折叠，状态能记到内存态。
- 路由切换可以切换模块挂载区内容。
- 页面没有接入业务前就已经具备稳定的布局和挂载机制。
