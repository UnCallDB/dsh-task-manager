# dsh-task-manager

DeepSeek Harness 的任务管理插件：左侧栏入口 + 任务面板。用来快速记录任务、按工作区（项目）归类、给任务配图片和模型，并把一条或多条任务发送到对应项目的会话里执行。

纯 JavaScript，无依赖、无构建步骤。

## 功能

- **快速记录**：输入框 `Enter` 保存，`Shift+Enter` 换行；支持粘贴 / 拖入 / 选择图片。
- **按项目归类**：新建时选项目，行内可随时改归属；顶部有「全部 / 各项目」筛选与计数。
- **任务级模型与推理等级**：从模型目录里选，发送时用 `session.selectModel` 指定；没指定等级时用该模型的默认等级。
- **发送执行**：在目标项目里新建会话，把任务内容作为第一条消息发出，会话随即开始跑；发送后任务自动标记完成，按钮变成「打开会话」。
- **合并发送**：勾选同一项目的多条任务 → 弹出二次确认窗口（内容可编辑、模型/推理等级可改，默认取第一条任务的模型）→ 只开一个会话。图片一起带上。
- **批量选择与完成分离**：每行左侧的方框只用于批量选择；「完成」是行尾的独立按钮，已完成的行显示「取消完成」。
- **回收站**：删除或「清除已完成」先移入回收站，可查看历史（项目、删除时间、图片、会话链接），支持恢复 / 彻底删除 / 清空。

## 安装

私有仓库，安装前确认本机 `git` 能访问该仓库（HTTPS 需要凭据，或改用 SSH）。

在 DSH 网页界面里：**设置 → 插件 → 添加插件**，填：

```
github:UnCallDB/dsh-task-manager
```

或者在终端：

```bash
dsh plugin --profile web add github:UnCallDB/dsh-task-manager
```

装好后刷新一次页面，左侧栏出现「任务管理」入口。

钉版本：`github:UnCallDB/dsh-task-manager#v1.0.0`（tag 或 commit 均可）。

## 数据存放

```
$DSH_HOME/task-manager/tasks.json    # 任务与回收站
$DSH_HOME/task-manager/images/       # 任务图片
```

默认 `~/.dsh/task-manager/`。插件不做云同步；换机器时把整个 `task-manager/` 目录拷过去即可。

## 接口

Host 半边只暴露一个前缀路由 `/task-manager/api`：

- `POST /task-manager/api`：JSON 方法调用（`list` / `add` / `update` / `remove` / `markSent` / `markSentMany` / `clearDone` / `restore` / `purge` / `emptyTrash` / `addImage` / `removeImage`）。
- `GET /task-manager/api/image/<uuid>.<ext>`：回读任务图片。

请求先过 `ctx.connection.requestRejection()`，非本机浏览器凭据一律 401。

## 限制

- 单张图片 ≤ 6 MB，一条任务最多 6 张，合并发送最多带 6 张。
- 合并发送仅限同一项目、一次最多 50 条。
- 回收站最多保留 200 条。
- 仅验证过 `web` profile 与 DSH `0.2.2-rc.1`。

## 开发

没有构建步骤，改完即用：

- `client.js`：浏览器半边（`window.__ModuleLoader__.load` 注册，向 `sidebar.panellist` 与 `main` 两个 slot 投稿）。改完刷新页面。
- `index.js`：Host 半边（存储 + 路由）。改完需要在插件管理里重载该 bundle。
- `cordis.patch.yml`：插入 `task-manager` 行；`name` 必须与本包名一致。

## 许可证

MIT
