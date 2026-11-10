/**
 * 任务管理 浏览器半实现。
 *
 * 通过 `window.__ModuleLoader__.load` 注册一个惰性工厂，向两个 slot 投稿：
 * - `sidebar.panellist`：左侧栏入口图标（id 与 main 面板的 key 相同）；
 * - `main`：任务面板本体，按工作区分组、支持图片与模型，一键发送到项目执行。
 *
 * 数据走 Host 的 `/task-manager/api`（同源 fetch）；「发送」复用已有的
 * `session.create` + `session.selectModel` + `session.prompt` Remote，
 * 不新造会话能力。注意 `remote.session` 在 Cordis 里是独立的服务键，
 * 必须同时注入 `remote` 与 `remote.session`。
 *
 * @module dsh-task-manager/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-task-manager',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    /** 面板 id：侧边栏入口 id 与 main slot 的 key 共用同一个值。 */
    const PANEL_ID = 'task-manager'
    /** 浏览器本地记住上次选择的项目 / 模型。 */
    const LAST_PROJECT_KEY = 'dsh-task-manager:last-project'
    const LAST_MODEL_KEY = 'dsh-task-manager:last-model'
    /** 未分类任务在分组里的 key。 */
    const NONE_KEY = '\u0000none'
    /** 稳定的空数组，避免每次渲染产生新引用。 */
    const NO_WORKSPACES = []
    /** 图片限制，与 Host 端保持一致。 */
    const MAX_IMAGE_BYTES = 6 * 1024 * 1024
    const MAX_IMAGES = 6
    /** 模型下拉的取值分隔符：provider 与 model 都不含 `|`。 */
    const MODEL_SEPARATOR = '|'
    /** 合并发送时一条消息最多带几张图片。 */
    const MAX_BATCH_IMAGES = 6

    const DICT = {
      zh: {
        nav: '任务管理',
        title: '任务管理',
        subtitle: '记下要做的事，按项目归档，挑好模型，一键发送给对应项目执行。',
        placeholder: '记一个任务… Enter 添加，Shift+Enter 换行，可直接粘贴图片',
        add: '添加',
        adding: '添加中…',
        all: '全部',
        project: '项目',
        model: '模型',
        defaultModel: '默认模型',
        reasoning: '推理等级',
        defaultEffort: '默认等级',
        reasoningHint: '这次执行使用的推理等级',
        modelUnavailable: '（不可用）',
        uncategorized: '未分类',
        removedProject: '（工作区已移除）',
        emptyTitle: '还没有任务',
        emptyHint: '在上面输入一句话就能记下第一条任务。',
        noWorkspace: '还没有工作区，先在左侧栏新建一个项目。',
        statsTodo: '{count} 待办',
        statsDone: '{count} 已完成',
        clearDone: '清除已完成',
        send: '发送执行',
        sending: '正在发送…',
        openSession: '打开会话',
        openSessionHint: '在左侧侧边栏定位并打开这次执行的会话',
        select: '选择',
        deselect: '取消选择',
        selectAll: '全选',
        selectDoneHint: '已完成的任务不参与合并',
        complete: '完成',
        reopen: '取消完成',
        selectedCount: '已选 {count} 条',
        selectHint: '勾选同一个项目里的多条任务，会合并成一条消息发到同一个会话',
        clearSelection: '清除选择',
        mergeSend: '合并发送执行',
        merging: '正在合并发送…',
        noticeMerged: '已将 {count} 条任务合并发送到「{project}」',
        mergeImagesCapped: '（图片超过 {count} 张，只带了前 {count} 张）',
        errorMixedProjects: '只能合并同一个项目的任务',
        errorBatchEmpty: '先勾选要合并的任务',
        rename: '重命名',
        remove: '删除',
        confirmRemove: '确认删除',
        sentAt: '已发送',
        justNow: '刚刚',
        minutesAgo: '{count} 分钟前',
        hoursAgo: '{count} 小时前',
        daysAgo: '{count} 天前',
        attachImage: '图片',
        attachImageHint: '选择图片，或直接粘贴 / 拖入',
        removeImage: '移除图片',
        uploadingImage: '图片上传中…',
        imageTooLarge: '图片超过 {size} MB，换一张小一点的',
        imageUnsupported: '只支持 PNG / JPEG / WebP / GIF',
        imageLimit: '一条任务最多 {count} 张图片',
        imageUploadFailed: '图片上传失败：{message}',
        taskImage: '任务图片',
        noticeAdded: '已记录到「{project}」',
        noticeAddedNone: '已记录到未分类',
        noticeSent: '已发送到「{project}」并标记完成，会话开始执行',
        noticeMoved: '已移动到「{project}」',
        noticeRemoved: '已删除任务',
        noticeCleared: '{count} 条已完成任务已清空到回收站',
        trash: '回收站',
        trashCount: '{count} 条',
        trashHint: '删除或清除的任务会先放在这里，可以恢复',
        trashEmpty: '回收站是空的',
        trashEmptyHint: '删除任务或清除已完成时，内容会先放到这里。',
        restore: '恢复',
        purge: '彻底删除',
        confirmPurge: '确认彻底删除',
        emptyTrash: '清空回收站',
        confirmEmptyTrash: '确认清空回收站',
        deletedAt: '删除于',
        sentBefore: '已发送',
        noticeRestored: '已恢复到待办',
        noticePurged: '已彻底删除这条任务',
        noticeTrashEmptied: '回收站已清空（{count} 条）',
        errorLoad: '任务列表读取失败：{message}',
        errorAdd: '添加任务失败：{message}',
        errorSend: '发送失败：{message}',
        errorNoProject: '这条任务还没有归属项目，先选择一个项目再发送。',
        errorGeneric: '操作失败：{message}',
        dismiss: '关闭',
        loading: '正在读取任务…',
        loadFailedTitle: '任务列表没能读取',
        retry: '重试',
        sendHint: '在对应项目里新建会话，并把任务内容作为第一条消息发送',
      },
      en: {
        nav: 'Tasks',
        title: 'Task manager',
        subtitle: 'Capture what to do, group it by project, pick a model, and send it to that project to run.',
        placeholder: 'Write a task… Enter to add, Shift+Enter for a new line, paste an image anytime',
        add: 'Add',
        adding: 'Adding…',
        all: 'All',
        project: 'Project',
        model: 'Model',
        defaultModel: 'Default model',
        reasoning: 'Reasoning',
        defaultEffort: 'Default level',
        reasoningHint: 'Reasoning effort this run uses',
        modelUnavailable: ' (unavailable)',
        uncategorized: 'Uncategorized',
        removedProject: '(workspace removed)',
        emptyTitle: 'No tasks yet',
        emptyHint: 'Type a line above to capture your first task.',
        noWorkspace: 'No workspace yet. Create a project in the sidebar first.',
        statsTodo: '{count} open',
        statsDone: '{count} done',
        clearDone: 'Clear done',
        send: 'Send and run',
        sending: 'Sending…',
        openSession: 'Open session',
        openSessionHint: 'Locate this run in the sidebar and open its session',
        select: 'Select',
        deselect: 'Deselect',
        selectAll: 'Select all',
        selectDoneHint: 'Done tasks cannot be merged',
        complete: 'Done',
        reopen: 'Reopen',
        selectedCount: '{count} selected',
        selectHint: 'Pick several tasks in one project and they are sent as one message to one session',
        clearSelection: 'Clear',
        mergeSend: 'Send merged',
        merging: 'Sending merged…',
        noticeMerged: 'Sent {count} tasks as one message to "{project}"',
        mergeImagesCapped: ' (only the first {count} images were attached)',
        errorMixedProjects: 'Select tasks from a single project',
        errorBatchEmpty: 'Select the tasks to merge first',
        rename: 'Rename',
        remove: 'Delete',
        confirmRemove: 'Confirm delete',
        sentAt: 'Sent',
        justNow: 'just now',
        minutesAgo: '{count} min ago',
        hoursAgo: '{count} h ago',
        daysAgo: '{count} d ago',
        attachImage: 'Image',
        attachImageHint: 'Pick an image, or paste / drop one',
        removeImage: 'Remove image',
        uploadingImage: 'Uploading image…',
        imageTooLarge: 'The image is larger than {size} MB',
        imageUnsupported: 'Only PNG / JPEG / WebP / GIF are supported',
        imageLimit: 'At most {count} images per task',
        imageUploadFailed: 'Image upload failed: {message}',
        taskImage: 'Task image',
        noticeAdded: 'Captured in "{project}"',
        noticeAddedNone: 'Captured as uncategorized',
        noticeSent: 'Sent to "{project}"; marked done and the session is running',
        noticeMoved: 'Moved to "{project}"',
        noticeRemoved: 'Task deleted',
        noticeCleared: 'Moved {count} done tasks to the recycle bin',
        trash: 'Recycle bin',
        trashCount: '{count} items',
        trashHint: 'Deleted and cleared tasks wait here and can be restored',
        trashEmpty: 'The recycle bin is empty',
        trashEmptyHint: 'Deleting a task or clearing done ones moves content here first.',
        restore: 'Restore',
        purge: 'Delete forever',
        confirmPurge: 'Confirm permanent delete',
        emptyTrash: 'Empty recycle bin',
        confirmEmptyTrash: 'Confirm emptying',
        deletedAt: 'Deleted',
        sentBefore: 'Sent',
        noticeRestored: 'Restored to open',
        noticePurged: 'Task deleted permanently',
        noticeTrashEmptied: 'Recycle bin emptied ({count} items)',
        errorLoad: 'Could not read tasks: {message}',
        errorAdd: 'Could not add the task: {message}',
        errorSend: 'Could not send the task: {message}',
        errorNoProject: 'This task has no project yet. Pick one before sending.',
        errorGeneric: 'Something failed: {message}',
        dismiss: 'Dismiss',
        loading: 'Reading tasks…',
        loadFailedTitle: 'Tasks did not load',
        retry: 'Retry',
        sendHint: 'Opens a new session in that project and sends the task as its first message',
      },
    }

    /** 按 `{name}` 占位符替换。 */
    function interpolate(template, params) {
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, name) =>
        params[name] === undefined ? match : String(params[name]),
      )
    }

    /**
     * 翻译函数：身份稳定，每次调用读取当前语言，因此不需要在语言切换时重建。
     * @param key - 词条 key。
     * @param params - `{name}` 占位符参数。
     */
    function translate(key, params) {
      const active = localeService === undefined ? 'zh' : localeService.getLocale()?.active
      const dict = String(active ?? '').toLowerCase().startsWith('zh') ? DICT.zh : DICT.en
      return interpolate(dict[key] ?? DICT.en[key] ?? key, params)
    }

    /** 生成一次 prompt 请求 id。 */
    function newRequestId() {
      const crypto = globalThis.crypto
      if (crypto !== undefined && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
      return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    }

    /** 浏览器时区，Host 会把它写进任务上下文。 */
    function clientTimeZone() {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone
      } catch {
        return undefined
      }
    }

    /** 读上次选择的项目 / 模型。 */
    function readStored(key) {
      try {
        return window.localStorage.getItem(key) ?? ''
      } catch {
        return ''
      }
    }

    /** 记住本次选择。 */
    function writeStored(key, value) {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        // 隐私模式下 localStorage 不可写，选择不回填即可。
      }
    }

    /** 图片落盘用的文件名后缀，与 Host 的映射保持一致。 */
    function imageExtension(mediaType) {
      return mediaType === 'image/jpeg' ? 'jpg' : String(mediaType).slice('image/'.length)
    }

    /** 图片回读地址。 */
    function imageUrl(image) {
      return new URL(
        `task-manager/api/image/${image.id}.${imageExtension(image.mediaType)}`,
        document.baseURI,
      ).href
    }

    /** ArrayBuffer → base64（分块拼接，避免超长参数爆栈）。 */
    function arrayBufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer)
      const chunk = 0x8000
      let binary = ''
      for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk))
      }
      return btoa(binary)
    }

    /** 读出任务图片的 base64，供发送时作为图片 part 使用。 */
    async function readImageBase64(image) {
      const response = await fetch(imageUrl(image))
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return arrayBufferToBase64(await response.arrayBuffer())
    }

    /** 模型选择 → 下拉取值。 */
    function modelKey(model) {
      if (model === null || model === undefined) return ''
      return `${model.provider}${MODEL_SEPARATOR}${model.model}`
    }

    /** 下拉取值 → 模型选择。 */
    function parseModelKey(key) {
      if (key === '') return null
      const at = key.indexOf(MODEL_SEPARATOR)
      if (at < 0) return null
      return { provider: key.slice(0, at), model: key.slice(at + 1) }
    }

    /** 一个模型支持的推理等级；没有 reasoning 能力时返回空数组。 */
    function effortsOf(catalog, model) {
      if (model === null || model === undefined) return []
      for (const group of catalog.groups) {
        if (group.id !== model.provider) continue
        const found = group.models.find((entry) => entry.id === model.model)
        if (found !== undefined) return Array.isArray(found.reasoning?.efforts) ? found.reasoning.efforts : []
      }
      return []
    }

    /** 目录里该模型的默认推理等级。 */
    function defaultEffortOf(catalog, model) {
      if (model === null || model === undefined) return undefined
      for (const group of catalog.groups) {
        if (group.id !== model.provider) continue
        const found = group.models.find((entry) => entry.id === model.model)
        const effort = found?.reasoning?.defaultEffort
        if (typeof effort === 'string' && effort !== '') return effort
      }
      return undefined
    }

    /**
     * 调用 Host 接口。失败一律抛带用户可读 message 的 Error。
     * @param method - 接口方法名。
     * @param payload - 其余字段。
     */
    async function callApi(method, payload = {}) {
      const url = new URL('task-manager/api', document.baseURI).href
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, ...payload }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || data === null || data.ok !== true) {
        const message = data?.error?.message ?? `HTTP ${response.status}`
        throw new Error(message)
      }
      return data.value
    }

    /** 订阅语言变化，触发重渲染。 */
    function useLocaleRevision() {
      const [revision, setRevision] = useState(0)
      useEffect(() => {
        const unsubscribe = localeService.subscribe(() => setRevision((value) => value + 1))
        return unsubscribe
      }, [])
      return revision
    }

    /** 不参与订阅的空实现，保证 hook 调用次数恒定。 */
    const noWorkspaces = () => NO_WORKSPACES

    /** 相对时间文案。 */
    function formatWhen(timestamp, t) {
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return ''
      const diff = Date.now() - timestamp
      if (diff < 60_000) return t('justNow')
      if (diff < 3_600_000) return t('minutesAgo', { count: Math.floor(diff / 60_000) })
      if (diff < 86_400_000) return t('hoursAgo', { count: Math.floor(diff / 3_600_000) })
      if (diff < 604_800_000) return t('daysAgo', { count: Math.floor(diff / 86_400_000) })
      return new Date(timestamp).toLocaleDateString()
    }

    /**
     * 侧边栏入口图标：与官方图标同一风格——16 视窗、只描边不填色、跟随 currentColor。
     * 形状取自产品内置的 checklist-outline 图标（regular 线宽）。
     */
    function TaskManagerIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 20
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1,
          'aria-hidden': true,
          focusable: 'false',
          style: { display: 'block' },
        },
        h('path', {
          d: 'M3.75 6.25C4.7165 6.25 5.5 5.4665 5.5 4.5C5.5 3.5335 4.7165 2.75 3.75 2.75C2.7835 2.75 2 3.5335 2 4.5C2 5.4665 2.7835 6.25 3.75 6.25Z',
        }),
        h('path', { d: 'M7.5 4.5H13.5' }),
        h('path', {
          d: 'M3.75 13.25C4.7165 13.25 5.5 12.4665 5.5 11.5C5.5 10.5335 4.7165 9.75 3.75 9.75C2.7835 9.75 2 10.5335 2 11.5C2 12.4665 2.7835 13.25 3.75 13.25Z',
        }),
        h('path', { d: 'M7.5 11.5H13.5' }),
      )
    }

    /** 模型下拉：按 provider 分组。 */
    function ModelOptions(props) {
      const { catalog, selected, t } = props
      const children = [h('option', { key: '', value: '' }, t('defaultModel'))]
      const known = new Set()
      for (const group of catalog.groups) {
        const options = []
        for (const model of group.models) {
          const key = `${group.id}${MODEL_SEPARATOR}${model.id}`
          known.add(key)
          options.push(h('option', { key, value: key }, model.name))
        }
        if (options.length > 0) children.push(h('optgroup', { key: group.id, label: group.name }, options))
      }
      if (selected !== null && selected !== undefined && !known.has(modelKey(selected))) {
        children.push(
          h(
            'option',
            { key: '__stale__', value: modelKey(selected) },
            `${selected.model}${t('modelUnavailable')}`,
          ),
        )
      }
      return children
    }

    /** 推理等级下拉：默认 + 该模型支持的各等级。 */
    function EffortOptions(props) {
      const { catalog, model, t } = props
      const children = [h('option', { key: '', value: '' }, t('defaultEffort'))]
      for (const effort of effortsOf(catalog, model)) {
        children.push(h('option', { key: effort.id, value: effort.id }, effort.name))
      }
      return children
    }

    /** 一张任务图片的缩略图。 */
    function Thumbnail(props) {
      const { image, t, className, onRemove } = props
      return h(
        'span',
        { className: className === undefined ? 'tm-thumb' : className },
        h('img', {
          src: imageUrl(image),
          alt: image.name ?? t('taskImage'),
          loading: 'lazy',
          draggable: false,
        }),
        onRemove === undefined
          ? null
          : h(
              'button',
              {
                type: 'button',
                className: 'tm-thumb-remove',
                title: t('removeImage'),
                'aria-label': t('removeImage'),
                onClick: () => onRemove(image),
              },
              '×',
            ),
      )
    }

    /** 单条任务行：左边是批量选择框，行尾是完成/取消完成与删除。 */
    function TaskRow(props) {
      const {
        task,
        t,
        workspaces,
        catalog,
        busy,
        selected,
        onSelect,
        onToggle,
        onRename,
        onRemove,
        onSend,
        onMove,
        onModel,
      } = props
      const [editing, setEditing] = useState(false)
      const [draft, setDraft] = useState(task.title)
      const [confirming, setConfirming] = useState(false)

      useEffect(() => {
        if (!editing) setDraft(task.title)
      }, [task.title, editing])

      useEffect(() => {
        if (!confirming) return undefined
        const timer = setTimeout(() => setConfirming(false), 4000)
        return () => clearTimeout(timer)
      }, [confirming])

      const commit = useCallback(() => {
        const text = draft.trim()
        setEditing(false)
        if (text === '' || text === task.title) {
          setDraft(task.title)
          return
        }
        onRename(task, text)
      }, [draft, onRename, task])

      const done = task.status === 'done'
      const images = Array.isArray(task.images) ? task.images : []
      const rowClass = ['tm-row', done ? 'tm-row-done' : '', selected ? 'tm-row-selected' : '']
        .filter((name) => name !== '')
        .join(' ')

      return h(
        'div',
        { className: rowClass },
        h(
          'button',
          {
            type: 'button',
            className: selected ? 'tm-check tm-check-on' : 'tm-check',
            role: 'checkbox',
            'aria-checked': selected,
            'aria-label': selected ? t('deselect') : t('select'),
            title: done ? t('selectDoneHint') : selected ? t('deselect') : t('select'),
            disabled: done,
            onClick: () => onSelect(task),
          },
          selected ? h('span', { className: 'tm-check-mark' }, '✓') : null,
        ),
        h(
          'div',
          { className: 'tm-row-main' },
          editing
            ? h('input', {
                className: 'tm-edit',
                value: draft,
                autoFocus: true,
                onChange: (event) => setDraft(event.target.value),
                onBlur: commit,
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commit()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    setDraft(task.title)
                    setEditing(false)
                  }
                },
              })
            : h(
                'button',
                {
                  type: 'button',
                  className: 'tm-row-title',
                  title: t('rename'),
                  onClick: () => setEditing(true),
                },
                task.title,
              ),
          images.length > 0
            ? h(
                'div',
                { className: 'tm-thumbs' },
                images.map((image) => h(Thumbnail, { key: image.id, image, t })),
              )
            : null,
          h(
            'div',
            { className: 'tm-row-meta' },
            h(
              'select',
              {
                className: 'tm-row-select',
                value: task.workspaceId ?? '',
                title: t('project'),
                onChange: (event) => onMove(task, event.target.value),
              },
              h('option', { value: '' }, t('uncategorized')),
              workspaces.map((workspace) =>
                h('option', { key: workspace.workspaceId, value: workspace.workspaceId }, workspace.title),
              ),
              task.workspaceId !== null &&
                !workspaces.some((workspace) => workspace.workspaceId === task.workspaceId)
                ? h(
                    'option',
                    { key: '__stale__', value: task.workspaceId },
                    `${task.workspaceTitle ?? task.workspaceId} ${t('removedProject')}`,
                  )
                : null,
            ),
            h(
              'select',
              {
                className: 'tm-row-select',
                value: modelKey(task.model),
                title: t('model'),
                onChange: (event) => {
                  const next = parseModelKey(event.target.value)
                  if (next === null) {
                    onModel(task, null)
                    return
                  }
                  const supported = effortsOf(catalog, next)
                  const previous = task.model?.reasoningEffort
                  const keep =
                    previous !== undefined && supported.some((entry) => entry.id === previous)
                      ? previous
                      : undefined
                  onModel(task, { ...next, ...(keep === undefined ? {} : { reasoningEffort: keep }) })
                },
              },
              h(ModelOptions, { catalog, selected: task.model, t }),
            ),
            effortsOf(catalog, task.model).length > 0
              ? h(
                  'select',
                  {
                    className: 'tm-row-select',
                    value: task.model?.reasoningEffort ?? '',
                    title: t('reasoningHint'),
                    onChange: (event) =>
                      onModel(task, {
                        ...task.model,
                        ...(event.target.value === ''
                          ? { reasoningEffort: undefined }
                          : { reasoningEffort: event.target.value }),
                      }),
                  },
                  h(EffortOptions, { catalog, model: task.model, t }),
                )
              : null,
            h('span', { className: 'tm-dot' }, '·'),
            h('span', null, formatWhen(task.createdAt, t)),
            task.sentAt !== undefined
              ? h(
                  'span',
                  { className: 'tm-sent' },
                  h('span', { className: 'tm-dot' }, '·'),
                  `${t('sentAt')} ${formatWhen(task.sentAt, t)}`,
                )
              : null,
          ),
        ),
        h(
          'div',
          { className: 'tm-row-actions' },
          task.lastSessionId === undefined
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'tm-btn tm-btn-ghost tm-btn-send',
                  disabled: busy || task.workspaceId === null,
                  title: task.workspaceId === null ? t('errorNoProject') : t('sendHint'),
                  onClick: () => onSend(task),
                },
                busy ? t('sending') : t('send'),
              )
            : h(
                'button',
                {
                  type: 'button',
                  className: 'tm-btn tm-btn-ghost tm-btn-send',
                  title: t('openSessionHint'),
                  onClick: () => props.onOpenSession(task.lastSessionId),
                },
                t('openSession'),
              ),
          h(
            'button',
            {
              type: 'button',
              className: 'tm-btn tm-btn-ghost',
              onClick: () => onToggle(task),
            },
            done ? t('reopen') : t('complete'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: confirming ? 'tm-btn tm-btn-danger' : 'tm-btn tm-btn-ghost',
              onClick: () => {
                if (confirming) onRemove(task)
                else setConfirming(true)
              },
            },
            confirming ? t('confirmRemove') : t('remove'),
          ),
        ),
      )
    }


    /** 回收站里的一条历史任务。 */
    function TrashRow(props) {
      const { entry, t, onRestore, onPurge, onOpenSession } = props
      const [confirming, setConfirming] = useState(false)

      useEffect(() => {
        if (!confirming) return undefined
        const timer = setTimeout(() => setConfirming(false), 4000)
        return () => clearTimeout(timer)
      }, [confirming])

      const images = Array.isArray(entry.images) ? entry.images : []
      const project = entry.workspaceTitle ?? t('uncategorized')
      return h(
        'div',
        { className: 'tm-row' },
        h(
          'div',
          { className: 'tm-row-main' },
          h('div', { className: 'tm-row-title tm-row-title-static' }, entry.title),
          images.length > 0
            ? h(
                'div',
                { className: 'tm-thumbs' },
                images.map((image) => h(Thumbnail, { key: image.id, image, t })),
              )
            : null,
          h(
            'div',
            { className: 'tm-row-meta' },
            h('span', null, project),
            h('span', { className: 'tm-dot' }, '·'),
            h('span', null, `${t('deletedAt')} ${formatWhen(entry.deletedAt, t)}`),
            entry.sentAt === undefined
              ? null
              : h(
                  'span',
                  { className: 'tm-sent' },
                  h('span', { className: 'tm-dot' }, '·'),
                  `${t('sentBefore')} ${formatWhen(entry.sentAt, t)}`,
                ),
          ),
        ),
        h(
          'div',
          { className: 'tm-row-actions' },
          entry.lastSessionId === undefined
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  className: 'tm-btn tm-btn-ghost',
                  onClick: () => onOpenSession(entry.lastSessionId),
                },
                t('openSession'),
              ),
          h(
            'button',
            {
              type: 'button',
              className: 'tm-btn tm-btn-ghost tm-btn-send',
              onClick: () => onRestore(entry),
            },
            t('restore'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: confirming ? 'tm-btn tm-btn-danger' : 'tm-btn tm-btn-ghost',
              onClick: () => {
                if (confirming) onPurge(entry)
                else setConfirming(true)
              },
            },
            confirming ? t('confirmPurge') : t('purge'),
          ),
        ),
      )
    }

    /** 面板本体。 */
    function TaskManagerPage(props) {
      useLocaleRevision()
      const t = translate
      const remote = remoteService
      const sessions = sessionsService
      const layoutService = uiWorkspaceService

      const useWorkspacesHook =
        typeof props.useWorkspaces === 'function' ? props.useWorkspaces : noWorkspaces
      const workspaces = useWorkspacesHook((snapshot) => snapshot.items ?? NO_WORKSPACES)

      const [tasks, setTasks] = useState([])
      const [trash, setTrash] = useState([])
      const [phase, setPhase] = useState('loading')
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [draft, setDraft] = useState('')
      const [images, setImages] = useState([])
      const [uploading, setUploading] = useState(0)
      const [targetProject, setTargetProject] = useState(() => readStored(LAST_PROJECT_KEY))
      const [composerModel, setComposerModel] = useState(() => readStored(LAST_MODEL_KEY))
      const [composerEffort, setComposerEffort] = useState('')
      const [catalog, setCatalog] = useState({ groups: [], default: null })
      const [filter, setFilter] = useState('all')
      const [busyId, setBusyId] = useState(null)
      const [adding, setAdding] = useState(false)
      const [confirmEmpty, setConfirmEmpty] = useState(false)
      const [selection, setSelection] = useState([])
      const [batchBusy, setBatchBusy] = useState(false)
      const [dragging, setDragging] = useState(false)
      const inputRef = useRef(null)
      const fileRef = useRef(null)

      /** 拉取一次全量任务。 */
      const reload = useCallback(async () => {
        try {
          const value = await callApi('list')
          setTasks(Array.isArray(value?.tasks) ? value.tasks : [])
          setTrash(Array.isArray(value?.trash) ? value.trash : [])
          setPhase('ready')
          setError(null)
        } catch (failure) {
          setPhase('error')
          setError(t('errorLoad', { message: failure.message }))
        }
      }, [t])

      useEffect(() => {
        void reload()
      }, [reload])

      // 模型目录：拿不到时只显示「默认模型」，不影响记录任务。
      useEffect(() => {
        let cancelled = false
        void (async () => {
          try {
            const response = await remote.session.modelCatalog()
            if (cancelled || response.ok !== true) return
            setCatalog({
              groups: Array.isArray(response.value.groups) ? response.value.groups : [],
              default: response.value.default ?? null,
            })
          } catch {
            // 模型目录是可选增强，失败保持空目录。
          }
        })()
        return () => {
          cancelled = true
        }
      }, [remote])

      // 项目选择随工作区变化收敛：记住的项目优先，其次第一个工作区。
      useEffect(() => {
        const ids = workspaces.map((workspace) => workspace.workspaceId)
        if (targetProject !== '' && ids.includes(targetProject)) return
        const remembered = readStored(LAST_PROJECT_KEY)
        const next = ids.includes(remembered) ? remembered : ids[0] ?? ''
        if (next !== targetProject) setTargetProject(next)
      }, [workspaces, targetProject])

      const projectOf = useCallback(
        (workspaceId) => {
          if (workspaceId === null) return { title: t('uncategorized'), path: '' }
          const found = workspaces.find((workspace) => workspace.workspaceId === workspaceId)
          if (found === undefined) return { title: t('removedProject'), path: workspaceId }
          return { title: found.title, path: found.path }
        },
        [t, workspaces],
      )

      /** 按项目分组；已知项目按注册表顺序，未知项目与未分类排在后面。 */
      const groups = useMemo(() => {
        const order = workspaces.map((workspace) => workspace.workspaceId)
        const buckets = new Map()
        for (const task of tasks) {
          const key = task.workspaceId ?? NONE_KEY
          let bucket = buckets.get(key)
          if (bucket === undefined) {
            bucket = { key, workspaceId: task.workspaceId ?? null, tasks: [] }
            buckets.set(key, bucket)
          }
          bucket.tasks.push(task)
        }
        const known = []
        for (const workspaceId of order) {
          const bucket = buckets.get(workspaceId)
          if (bucket === undefined) continue
          const workspace = workspaces.find((item) => item.workspaceId === workspaceId)
          known.push({ ...bucket, title: workspace?.title ?? workspaceId, path: workspace?.path ?? '' })
          buckets.delete(workspaceId)
        }
        const rest = [...buckets.values()].map((bucket) => ({
          ...bucket,
          title: bucket.workspaceId === null ? t('uncategorized') : projectOf(bucket.workspaceId).title,
          path: bucket.workspaceId === null ? '' : projectOf(bucket.workspaceId).path,
        }))
        return [...known, ...rest]
      }, [projectOf, t, tasks, workspaces])

      const visibleGroups = useMemo(
        () => (filter === 'all' ? groups : groups.filter((group) => group.key === filter)),
        [filter, groups],
      )

      // 离开回收站时收起「确认清空」。
      useEffect(() => {
        if (filter !== 'trash' && confirmEmpty) setConfirmEmpty(false)
      }, [confirmEmpty, filter])

      // 任务被移动或删除后，选中的分组可能整体消失：回到「全部」。
      useEffect(() => {
        if (filter === 'all' || filter === 'trash') return
        if (groups.some((group) => group.key === filter)) return
        setFilter('all')
      }, [filter, groups])

      const composerSelection = parseModelKey(composerModel)

      /** 仍在待办里的选中任务；已完成或被清掉的自然从选择里消失。 */
      const selectedTasks = useMemo(
        () => tasks.filter((task) => selection.includes(task.id) && task.status !== 'done'),
        [selection, tasks],
      )
      const firstSelected = selectedTasks[0]
      const mixedProjects =
        selectedTasks.length > 1 &&
        selectedTasks.some((task) => task.workspaceId !== firstSelected.workspaceId)
      const batchWorkspace =
        firstSelected === undefined || mixedProjects || firstSelected.workspaceId === null
          ? undefined
          : workspaces.find((workspace) => workspace.workspaceId === firstSelected.workspaceId)
      const mixedModels =
        selectedTasks.length > 1 &&
        selectedTasks.some((task) => modelKey(task.model) !== modelKey(firstSelected.model))
      const canBatch =
        selectedTasks.length > 0 &&
        !mixedProjects &&
        firstSelected.workspaceId !== null &&
        batchWorkspace !== undefined

      const stats = useMemo(() => {
        let todo = 0
        let done = 0
        for (const task of tasks) {
          if (task.status === 'done') done += 1
          else todo += 1
        }
        return { todo, done }
      }, [tasks])

      const totalShown = useMemo(
        () => visibleGroups.reduce((total, group) => total + group.tasks.length, 0),
        [visibleGroups],
      )

      /** 替换一条任务，保持列表顺序。 */
      const replaceTask = useCallback((next) => {
        setTasks((current) => current.map((task) => (task.id === next.id ? next : task)))
      }, [])

      /** 上传一张图片，返回 Host 记录的元数据。 */
      const uploadImage = useCallback(
        async (file) => {
          if (!String(file.type).startsWith('image/')) throw new Error(t('imageUnsupported'))
          if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
            throw new Error(t('imageUnsupported'))
          }
          if (file.size > MAX_IMAGE_BYTES) {
            throw new Error(t('imageTooLarge', { size: Math.round(MAX_IMAGE_BYTES / 1048576) }))
          }
          const data = arrayBufferToBase64(await file.arrayBuffer())
          const value = await callApi('addImage', {
            mediaType: file.type,
            data,
            name: file.name || undefined,
          })
          return value.image
        },
        [t],
      )

      /** 批量接收图片（粘贴 / 拖入 / 选择文件共用）。 */
      const acceptFiles = useCallback(
        async (files) => {
          const list = Array.from(files ?? [])
          if (list.length === 0) return
          setError(null)
          for (const file of list) {
            if (images.length >= MAX_IMAGES) {
              setError(t('imageLimit', { count: MAX_IMAGES }))
              break
            }
            setUploading((value) => value + 1)
            try {
              const image = await uploadImage(file)
              setImages((current) =>
                current.length >= MAX_IMAGES ? current : [...current, image],
              )
            } catch (failure) {
              setError(t('imageUploadFailed', { message: failure.message }))
            } finally {
              setUploading((value) => value - 1)
            }
          }
        },
        [images.length, t, uploadImage],
      )

      /** 移除一张还没提交的图片。 */
      const dropComposerImage = useCallback(async (image) => {
        setImages((current) => current.filter((entry) => entry.id !== image.id))
        try {
          await callApi('removeImage', { id: image.id })
        } catch {
          // 文件回收失败不影响界面，最多留一个孤儿文件。
        }
      }, [])

      /** 添加任务。 */
      const submit = useCallback(async () => {
        const text = draft.trim()
        if (text === '' || adding || uploading > 0) return
        setAdding(true)
        setError(null)
        const workspace = workspaces.find((item) => item.workspaceId === targetProject)
        try {
          const value = await callApi('add', {
            title: text,
            workspaceId: workspace?.workspaceId ?? null,
            workspaceTitle: workspace?.title ?? null,
            images,
            model: composerSelection === null
              ? null
              : {
                  ...composerSelection,
                  ...(composerEffort === '' ? {} : { reasoningEffort: composerEffort }),
                },
          })
          setTasks((current) => [value.task, ...current])
          setDraft('')
          setImages([])
          setNotice({
            text:
              workspace === undefined
                ? t('noticeAddedNone')
                : t('noticeAdded', { project: workspace.title }),
          })
          if (inputRef.current !== null) inputRef.current.focus()
        } catch (failure) {
          setError(t('errorAdd', { message: failure.message }))
        } finally {
          setAdding(false)
        }
      }, [adding, composerEffort, composerSelection, draft, images, t, targetProject, uploading, workspaces])

      /** 勾选 / 取消勾选。 */
      const toggle = useCallback(
        async (task) => {
          const status = task.status === 'done' ? 'todo' : 'done'
          try {
            const value = await callApi('update', { id: task.id, status })
            replaceTask(value.task)
          } catch (failure) {
            setError(t('errorGeneric', { message: failure.message }))
          }
        },
        [replaceTask, t],
      )

      /** 重命名。 */
      const rename = useCallback(
        async (task, title) => {
          try {
            const value = await callApi('update', { id: task.id, title })
            replaceTask(value.task)
          } catch (failure) {
            setError(t('errorGeneric', { message: failure.message }))
          }
        },
        [replaceTask, t],
      )

      /** 改归属项目。 */
      const move = useCallback(
        async (task, workspaceId) => {
          const workspace = workspaces.find((item) => item.workspaceId === workspaceId)
          try {
            const value = await callApi('update', {
              id: task.id,
              workspaceId: workspaceId === '' ? null : workspaceId,
              workspaceTitle: workspace?.title ?? null,
            })
            replaceTask(value.task)
            setNotice({
              text:
                workspace === undefined
                  ? t('noticeAddedNone')
                  : t('noticeMoved', { project: workspace.title }),
            })
          } catch (failure) {
            setError(t('errorGeneric', { message: failure.message }))
          }
        },
        [replaceTask, t, workspaces],
      )

      /** 改执行模型（含推理等级）。 */
      const setModel = useCallback(
        async (task, model) => {
          try {
            const value = await callApi('update', { id: task.id, model })
            replaceTask(value.task)
          } catch (failure) {
            setError(t('errorGeneric', { message: failure.message }))
          }
        },
        [replaceTask, t],
      )

      // 任务被完成、合并发送或删除后，把失效的 id 从选择里剔掉。
      useEffect(() => {
        setSelection((current) => {
          const next = current.filter((id) =>
            tasks.some((task) => task.id === id && task.status !== 'done'),
          )
          return next.length === current.length ? current : next
        })
      }, [tasks])

      /** 勾选 / 取消勾选一条任务。 */
      const toggleSelect = useCallback((task) => {
        setSelection((current) =>
          current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id],
        )
      }, [])

      /**
       * 合并发送：把选中的任务编成一条消息，发到它们共同项目的一个新会话里。
       */
      const sendBatch = useCallback(async () => {
        if (batchBusy) return
        if (selectedTasks.length === 0) {
          setError(t('errorBatchEmpty'))
          return
        }
        if (!canBatch || batchWorkspace === undefined) {
          setError(t('errorMixedProjects'))
          return
        }
        setBatchBusy(true)
        setError(null)
        try {
          const list = selectedTasks
          const text = list.map((task, index) => `${index + 1}. ${task.title}`).join('\n')
          const content = [{ type: 'text', text }]
          let attached = 0
          let capped = false
          for (const task of list) {
            for (const image of Array.isArray(task.images) ? task.images : []) {
              if (attached >= MAX_BATCH_IMAGES) {
                capped = true
                continue
              }
              content.push({
                type: 'image',
                mediaType: image.mediaType,
                data: await readImageBase64(image),
                ...(image.name === undefined ? {} : { name: image.name }),
              })
              attached += 1
            }
          }
          const sessionId = await sessions.create({ workspaceId: batchWorkspace.workspaceId })
          const model = mixedModels ? null : firstSelected.model
          if (model !== null && model !== undefined) {
            const effort = model.reasoningEffort ?? defaultEffortOf(catalog, model)
            const selected = await remote.session.selectModel({
              sessionId,
              provider: model.provider,
              model: model.model,
              ...(effort === undefined ? {} : { reasoningEffort: effort }),
            })
            if (selected.ok !== true) {
              throw new Error(selected.error?.message ?? 'session.selectModel rejected')
            }
          }
          const prompted = await remote.session.prompt({
            requestId: newRequestId(),
            sessionId,
            mode: 'queue',
            content,
            clientTimeZone: clientTimeZone(),
          })
          if (prompted.ok !== true) {
            throw new Error(prompted.error?.message ?? 'session.prompt rejected')
          }
          await callApi('markSentMany', { ids: list.map((task) => task.id), sessionId })
          setSelection([])
          await reload()
          setNotice({
            text:
              t('noticeMerged', { count: list.length, project: batchWorkspace.title }) +
              (capped ? ` ${t('mergeImagesCapped', { count: MAX_BATCH_IMAGES })}` : ''),
            sessionId,
          })
        } catch (failure) {
          setError(t('errorSend', { message: failure.message }))
        } finally {
          setBatchBusy(false)
        }
      }, [
        batchBusy,
        batchWorkspace,
        canBatch,
        catalog,
        firstSelected,
        mixedModels,
        reload,
        remote,
        selectedTasks,
        sessions,
        t,
      ])

      /** 删除：移入回收站。 */
      const remove = useCallback(
        async (task) => {
          try {
            await callApi('remove', { id: task.id })
            await reload()
            setNotice({ text: t('noticeRemoved') })
          } catch (failure) {
            setError(t('errorGeneric', { message: failure.message }))
          }
        },
        [reload, t],
      )

      /** 清除已完成：移入回收站。 */
      const clearDone = useCallback(async () => {
        try {
          const value = await callApi('clearDone')
          await reload()
          setNotice({ text: t('noticeCleared', { count: value.removed }) })
        } catch (failure) {
          setError(t('errorGeneric', { message: failure.message }))
        }
      }, [reload, t])

      /** 从回收站恢复一条任务。 */
      const restoreTask = useCallback(
        async (entry) => {
          try {
            await callApi('restore', { id: entry.id })
            setFilter('all')
            await reload()
            setNotice({ text: t('noticeRestored') })
          } catch (failure) {
            setError(t('errorGeneric', { message: failure.message }))
          }
        },
        [reload, t],
      )

      /** 彻底删除回收站里的一条任务。 */
      const purgeTask = useCallback(
        async (entry) => {
          try {
            await callApi('purge', { id: entry.id })
            await reload()
            setNotice({ text: t('noticePurged') })
          } catch (failure) {
            setError(t('errorGeneric', { message: failure.message }))
          }
        },
        [reload, t],
      )

      /** 清空回收站。 */
      const emptyTrash = useCallback(async () => {
        try {
          const value = await callApi('emptyTrash')
          setConfirmEmpty(false)
          await reload()
          setNotice({ text: t('noticeTrashEmptied', { count: value.removed }) })
        } catch (failure) {
          setError(t('errorGeneric', { message: failure.message }))
        }
      }, [reload, t])

      /**
       * 发送到项目并自动执行：在目标工作区新建会话，必要时先选模型，
       * 再把任务文本与图片作为第一条消息发出。
       * @param task - 待发送任务。
       */
      const send = useCallback(
        async (task) => {
          if (task.workspaceId === null) {
            setError(t('errorNoProject'))
            return
          }
          if (busyId !== null) return
          setBusyId(task.id)
          setError(null)
          const project = projectOf(task.workspaceId)
          try {
            // 先把图片读成 base64，避免会话建好后卡在附件读取上。
            const content = [{ type: 'text', text: task.title }]
            for (const image of Array.isArray(task.images) ? task.images : []) {
              content.push({
                type: 'image',
                mediaType: image.mediaType,
                data: await readImageBase64(image),
                ...(image.name === undefined ? {} : { name: image.name }),
              })
            }
            // 走客户端的 sessions 服务：它会把新会话记进会话目录，
            // 左侧侧边栏才立刻有这一行可以选中/定位。
            const sessionId = await sessions.create({ workspaceId: task.workspaceId })
            if (task.model !== null && task.model !== undefined) {
              // 与 DSH 自己的模型选择一致：没指定等级时用该模型的默认等级。
              const effort = task.model.reasoningEffort ?? defaultEffortOf(catalog, task.model)
              const selected = await remote.session.selectModel({
                sessionId,
                provider: task.model.provider,
                model: task.model.model,
                ...(effort === undefined ? {} : { reasoningEffort: effort }),
              })
              if (selected.ok !== true) {
                throw new Error(selected.error?.message ?? 'session.selectModel rejected')
              }
            }
            const prompted = await remote.session.prompt({
              requestId: newRequestId(),
              sessionId,
              mode: 'queue',
              content,
              clientTimeZone: clientTimeZone(),
            })
            if (prompted.ok !== true) {
              throw new Error(prompted.error?.message ?? 'session.prompt rejected')
            }
            const value = await callApi('markSent', { id: task.id, sessionId })
            replaceTask(value.task)
            setNotice({
              text: t('noticeSent', { project: project.title }),
              sessionId,
            })
          } catch (failure) {
            setError(t('errorSend', { message: failure.message }))
          } finally {
            setBusyId(null)
          }
        },
        [busyId, catalog, projectOf, remote, replaceTask, sessions, t],
      )

      /** 打开任务关联的会话。 */
      const openSession = useCallback(
        (sessionId) => {
          try {
            layoutService.openSession(sessionId)
          } catch (failure) {
            setError(t('errorGeneric', { message: failure.message }))
          }
        },
        [layoutService, t],
      )

      const chips = h(
        'div',
        { className: 'tm-chips' },
        h(
          'button',
          {
            type: 'button',
            className: filter === 'all' ? 'tm-chip tm-chip-on' : 'tm-chip',
            onClick: () => setFilter('all'),
          },
          t('all'),
          h('span', { className: 'tm-chip-count' }, String(tasks.length)),
        ),
        groups.map((group) =>
          h(
            'button',
            {
              key: group.key,
              type: 'button',
              className: filter === group.key ? 'tm-chip tm-chip-on' : 'tm-chip',
              onClick: () => setFilter(group.key),
              title: group.path === '' ? group.title : group.path,
            },
            group.title,
            h('span', { className: 'tm-chip-count' }, String(group.tasks.length)),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            className: filter === 'trash' ? 'tm-chip tm-chip-on' : 'tm-chip',
            title: t('trashHint'),
            onClick: () => setFilter('trash'),
          },
          t('trash'),
          h('span', { className: 'tm-chip-count' }, String(trash.length)),
        ),
      )

      // 回收站视图：历史任务可以查看、恢复或彻底删除。
      const trashView = h(
        'div',
        { className: 'tm-trash' },
        h(
          'div',
          { className: 'tm-trash-bar' },
          h('span', { className: 'tm-trash-hint' }, t('trashHint')),
          h('span', { className: 'tm-trash-count' }, t('trashCount', { count: trash.length })),
          trash.length === 0
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  className: confirmEmpty ? 'tm-btn tm-btn-danger' : 'tm-btn tm-btn-ghost',
                  onClick: () => {
                    if (confirmEmpty) void emptyTrash()
                    else setConfirmEmpty(true)
                  },
                },
                confirmEmpty ? t('confirmEmptyTrash') : t('emptyTrash'),
              ),
        ),
        trash.length === 0
          ? h(
              'div',
              { className: 'tm-empty' },
              h('p', { className: 'tm-empty-title' }, t('trashEmpty')),
              h('p', { className: 'tm-empty-hint' }, t('trashEmptyHint')),
            )
          : trash.map((entry) =>
              h(TrashRow, {
                key: entry.id,
                entry,
                t,
                onRestore: (item) => void restoreTask(item),
                onPurge: (item) => void purgeTask(item),
                onOpenSession: openSession,
              }),
            ),
      )

      // 列表区：回收站视图与任务分组共用同一个容器。
      const listView =
        filter === 'trash'
          ? trashView
          : phase === 'loading'
            ? h('p', { className: 'tm-empty' }, t('loading'))
            : phase === 'error'
              ? h(
                  'div',
                  { className: 'tm-empty' },
                  h('p', { className: 'tm-empty-title' }, t('loadFailedTitle')),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'tm-link',
                      onClick: () => {
                        setPhase('loading')
                        void reload()
                      },
                    },
                    t('retry'),
                  ),
                )
              : totalShown === 0
                ? h(
                    'div',
                    { className: 'tm-empty' },
                    h('p', { className: 'tm-empty-title' }, t('emptyTitle')),
                    h('p', { className: 'tm-empty-hint' }, t('emptyHint')),
                  )
                : visibleGroups.map((group) =>
                    h(
                      'div',
                      { key: group.key, className: 'tm-group' },
                      h(
                        'div',
                        { className: 'tm-group-head' },
                        h('span', { className: 'tm-group-title' }, group.title),
                        group.path === '' ? null : h('span', { className: 'tm-group-path' }, group.path),
                        h('span', { className: 'tm-group-count' }, String(group.tasks.length)),
                      ),
                      group.tasks.map((task) =>
                        h(TaskRow, {
                          key: task.id,
                          task,
                          t,
                          workspaces,
                          catalog,
                          busy: busyId === task.id,
                          selected: task.status !== 'done' && selection.includes(task.id),
                          onSelect: toggleSelect,
                          onToggle: (entry) => void toggle(entry),
                          onRename: (entry, title) => void rename(entry, title),
                          onRemove: (entry) => void remove(entry),
                          onSend: (entry) => void send(entry),
                          onMove: (entry, workspaceId) => void move(entry, workspaceId),
                          onModel: (entry, key) => void setModel(entry, key),
                          onOpenSession: openSession,
                        }),
                      ),
                    ),
                  )


      return h(
        'div',
        { className: 'tm-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'tm-inner' },
          h(
            'header',
            { className: 'tm-head' },
            h(
              'div',
              null,
              h('h1', { className: 'tm-title' }, t('title')),
              h('p', { className: 'tm-sub' }, t('subtitle')),
            ),
            h(
              'div',
              { className: 'tm-stats' },
              h('span', null, t('statsTodo', { count: stats.todo })),
              h('span', { className: 'tm-dot' }, '·'),
              h('span', null, t('statsDone', { count: stats.done })),
              stats.done > 0
                ? h('button', { type: 'button', className: 'tm-link', onClick: clearDone }, t('clearDone'))
                : null,
            ),
          ),
          h(
            'section',
            {
              className: dragging ? 'tm-card tm-card-drop' : 'tm-card',
              onDragOver: (event) => {
                if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return
                event.preventDefault()
                setDragging(true)
              },
              onDragLeave: () => setDragging(false),
              onDrop: (event) => {
                if (event.dataTransfer?.files == null) return
                event.preventDefault()
                setDragging(false)
                void acceptFiles(event.dataTransfer.files)
              },
            },
            h('textarea', {
              ref: inputRef,
              className: 'tm-input',
              rows: 2,
              value: draft,
              autoFocus: true,
              placeholder: t('placeholder'),
              onChange: (event) => setDraft(event.target.value),
              onPaste: (event) => {
                const files = []
                for (const item of event.clipboardData?.items ?? []) {
                  if (item.kind !== 'file' || !String(item.type).startsWith('image/')) continue
                  const file = item.getAsFile()
                  if (file !== null) files.push(file)
                }
                if (files.length === 0) return
                event.preventDefault()
                void acceptFiles(files)
              },
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void submit()
                }
              },
            }),
            images.length > 0 || uploading > 0
              ? h(
                  'div',
                  { className: 'tm-composer-thumbs' },
                  images.map((image) =>
                    h(Thumbnail, {
                      key: image.id,
                      image,
                      t,
                      className: 'tm-composer-thumb',
                      onRemove: (entry) => void dropComposerImage(entry),
                    }),
                  ),
                  uploading > 0
                    ? h('span', { className: 'tm-uploading' }, t('uploadingImage'))
                    : null,
                )
              : null,
            h(
              'div',
              { className: 'tm-card-row' },
              h(
                'label',
                { className: 'tm-field' },
                h('span', { className: 'tm-label' }, t('project')),
                h(
                  'select',
                  {
                    className: 'tm-select',
                    value: targetProject,
                    onChange: (event) => {
                      setTargetProject(event.target.value)
                      writeStored(LAST_PROJECT_KEY, event.target.value)
                    },
                  },
                  workspaces.length === 0 ? h('option', { value: '' }, t('uncategorized')) : null,
                  workspaces.map((workspace) =>
                    h('option', { key: workspace.workspaceId, value: workspace.workspaceId }, workspace.title),
                  ),
                ),
              ),
              h(
                'label',
                { className: 'tm-field' },
                h('span', { className: 'tm-label' }, t('model')),
                h(
                  'select',
                  {
                    className: 'tm-select',
                    value: composerModel,
                    onChange: (event) => {
                      setComposerModel(event.target.value)
                      writeStored(LAST_MODEL_KEY, event.target.value)
                      // 换模型后旧的等级未必支持，回到该模型的默认等级。
                      setComposerEffort('')
                    },
                  },
                  h(ModelOptions, { catalog, selected: composerSelection, t }),
                ),
              ),
              effortsOf(catalog, composerSelection).length > 0
                ? h(
                    'label',
                    { className: 'tm-field' },
                    h('span', { className: 'tm-label' }, t('reasoning')),
                    h(
                      'select',
                      {
                        className: 'tm-select',
                        value: composerEffort,
                        title: t('reasoningHint'),
                        onChange: (event) => setComposerEffort(event.target.value),
                      },
                      h(EffortOptions, { catalog, model: composerSelection, t }),
                    ),
                  )
                : null,
              h(
                'button',
                {
                  type: 'button',
                  className: 'tm-add-image',
                  title: t('attachImageHint'),
                  'aria-label': t('attachImage'),
                  disabled: uploading > 0 || images.length >= MAX_IMAGES,
                  onClick: () => fileRef.current?.click(),
                },
                h(
                  'svg',
                  {
                    viewBox: '0 0 16 16',
                    width: 14,
                    height: 14,
                    fill: 'none',
                    stroke: 'currentColor',
                    strokeWidth: 1.3,
                    'aria-hidden': true,
                    focusable: 'false',
                  },
                  h('path', { d: 'M8 2V14' }),
                  h('path', { d: 'M2 8H14' }),
                ),
              ),
              h('input', {
                ref: fileRef,
                type: 'file',
                accept: 'image/png,image/jpeg,image/webp,image/gif',
                multiple: true,
                className: 'tm-file',
                onChange: (event) => {
                  void acceptFiles(event.target.files)
                  event.target.value = ''
                },
              }),
              workspaces.length === 0 ? h('span', { className: 'tm-hint' }, t('noWorkspace')) : null,
              h(
                'button',
                {
                  type: 'button',
                  className: 'tm-btn tm-btn-primary',
                  disabled: adding || uploading > 0 || draft.trim() === '',
                  onClick: () => void submit(),
                },
                adding ? t('adding') : t('add'),
              ),
            ),
          ),
          error !== null
            ? h(
                'div',
                { className: 'tm-banner tm-banner-error', role: 'alert' },
                h('span', null, error),
                h('button', { type: 'button', className: 'tm-link', onClick: () => setError(null) }, t('dismiss')),
              )
            : null,
          notice !== null
            ? h(
                'div',
                { className: 'tm-banner tm-banner-ok', role: 'status' },
                h('span', null, notice.text),
                notice.sessionId !== undefined
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'tm-link',
                        onClick: () => openSession(notice.sessionId),
                      },
                      t('openSession'),
                    )
                  : null,
                h('button', { type: 'button', className: 'tm-link', onClick: () => setNotice(null) }, t('dismiss')),
              )
            : null,
          groups.length > 0 || trash.length > 0 ? chips : null,
          selectedTasks.length > 0 && filter !== 'trash'
            ? h(
                'div',
                { className: 'tm-batch' },
                h('span', { className: 'tm-batch-count' }, t('selectedCount', { count: selectedTasks.length })),
                h(
                  'span',
                  { className: 'tm-batch-hint' },
                  selectedTasks.length === 0
                    ? t('selectHint')
                    : mixedProjects
                      ? t('errorMixedProjects')
                      : `${batchWorkspace?.title ?? ''}${mixedModels ? ` · ${t('defaultModel')}` : ''}`,
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'tm-btn tm-btn-ghost',
                    onClick: () =>
                      setSelection(
                        tasks
                          .filter(
                            (task) =>
                              task.status !== 'done' && task.workspaceId === firstSelected.workspaceId,
                          )
                          .map((task) => task.id),
                      ),
                  },
                  t('selectAll'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'tm-btn tm-btn-ghost', onClick: () => setSelection([]) },
                  t('clearSelection'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'tm-btn tm-btn-primary',
                    disabled: batchBusy || !canBatch,
                    onClick: () => void sendBatch(),
                  },
                  batchBusy ? t('merging') : t('mergeSend'),
                ),
              )
            : null,
          h('section', { className: 'tm-list' }, listView),
        ),
      )
    }

    /* 面板样式：只用 --dsw-alias-* 主题 token，随明暗主题切换。 */
    const CSS = `
.tm-root { height: 100%; overflow-y: auto; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.tm-root * { box-sizing: border-box; }
.tm-inner { max-width: 880px; margin: 0 auto; padding: 32px 36px 72px; display: flex; flex-direction: column; gap: 18px; }
.tm-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.tm-title { margin: 0; font-size: 20px; line-height: 1.35; font-weight: 600; letter-spacing: 0.01em; }
.tm-sub { margin: 6px 0 0; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.tm-stats { display: flex; align-items: center; gap: 8px; padding-top: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.tm-card { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.tm-card-drop { border-color: var(--dsw-alias-brand-primary); }
.tm-input { width: 100%; min-height: 52px; border: 0; outline: none; resize: vertical; background: transparent; color: inherit; font: inherit; font-size: 14px; line-height: 1.65; padding: 6px 8px; }
.tm-input::placeholder { color: var(--dsw-alias-label-secondary); }
.tm-card-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tm-field { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); min-width: 0; }
.tm-label { white-space: nowrap; }
.tm-select { appearance: auto; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 8px; font: inherit; font-size: 12px; padding: 5px 8px; max-width: 220px; }
.tm-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.tm-file { display: none; }
.tm-add-image { corner-shape: round; background: var(--dsw-specific-selector, var(--dsw-alias-bg-layer-2)); width: 28px; height: 28px; color: var(--dsw-alias-label-primary); cursor: pointer; border: none; border-radius: 999px; flex: none; place-items: center; display: grid; padding: 0; }
.tm-add-image:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-solid, var(--dsw-alias-bg-overlay)); }
.tm-add-image:disabled { opacity: 0.5; cursor: default; }
.tm-uploading { display: inline-flex; align-items: center; font-size: 11px; color: var(--dsw-alias-label-secondary); padding: 0 4px; }
.tm-btn { appearance: none; border: 1px solid transparent; background: transparent; color: inherit; font: inherit; font-size: 12px; line-height: 1.4; padding: 6px 12px; border-radius: 8px; cursor: pointer; transition: background 120ms ease, border-color 120ms ease, opacity 120ms ease; }
.tm-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l1); }
.tm-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.tm-btn-primary { margin-left: auto; background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary)); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-base)); font-weight: 500; }
.tm-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary)); border-color: transparent; }
.tm-btn-ghost { color: var(--dsw-alias-label-secondary); }
.tm-btn-send { color: var(--dsw-alias-brand-primary); }
.tm-btn-danger { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.tm-link { appearance: none; border: 0; background: transparent; color: var(--dsw-alias-brand-primary); font: inherit; font-size: 12px; padding: 0 2px; cursor: pointer; }
.tm-link:hover { text-decoration: underline; }
.tm-banner { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 10px; font-size: 12px; line-height: 1.5; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.tm-banner > span { flex: 1; }
.tm-banner-ok { border-color: var(--dsw-alias-state-success-primary); }
.tm-banner-error { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.tm-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.tm-chip { appearance: none; border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; max-width: 260px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tm-chip:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }
.tm-chip-on { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.tm-chip-count { font-size: 11px; opacity: 0.7; }
.tm-list { display: flex; flex-direction: column; gap: 18px; }
.tm-group { display: flex; flex-direction: column; gap: 2px; }
.tm-group-head { display: flex; align-items: baseline; gap: 8px; padding: 0 4px 6px; }
.tm-group-title { font-size: 13px; font-weight: 600; }
.tm-group-path { font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; direction: rtl; text-align: left; flex: 0 1 auto; }
.tm-group-count { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.tm-row { display: flex; align-items: flex-start; gap: 10px; padding: 9px 10px; border-radius: 10px; border: 1px solid transparent; }
.tm-row:hover { background: var(--dsw-alias-bg-layer-1); border-color: var(--dsw-alias-border-l1); }
.tm-row-done .tm-row-title { color: var(--dsw-alias-label-secondary); text-decoration: line-through; }
.tm-check { flex: 0 0 18px; width: 18px; height: 18px; margin-top: 2px; padding: 0; border-radius: 6px; border: 1.5px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary-foreground, #fff); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; line-height: 1; }
.tm-check-on { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.tm-check-mark { transform: translateY(-0.5px); }
.tm-check:disabled { opacity: 0.35; cursor: default; }
.tm-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.tm-row-title { appearance: none; border: 0; background: transparent; color: inherit; font: inherit; font-size: 14px; line-height: 1.55; text-align: left; padding: 0; cursor: text; word-break: break-word; }
.tm-edit { width: 100%; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: inherit; font: inherit; font-size: 14px; line-height: 1.55; padding: 3px 6px; border-radius: 6px; outline: none; }
.tm-row-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.tm-row-select { appearance: auto; border: 1px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11px; padding: 1px 2px; border-radius: 6px; max-width: 200px; }
.tm-row-select:hover { border-color: var(--dsw-alias-border-l1); }
.tm-dot { opacity: 0.55; }
.tm-sent { display: inline-flex; align-items: center; gap: 6px; }
.tm-thumbs { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 0 2px; }
.tm-thumb { display: block; width: 56px; height: 56px; }
.tm-thumb img { width: 100%; height: 100%; object-fit: cover; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); }
.tm-composer-thumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 2px 8px; }
.tm-composer-thumb { position: relative; display: block; width: 62px; height: 62px; }
.tm-composer-thumb img { width: 100%; height: 100%; object-fit: cover; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); }
.tm-thumb-remove { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; padding: 0; border-radius: 50%; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.tm-row-actions { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; opacity: 0.78; transition: opacity 120ms ease; }
.tm-row:hover .tm-row-actions, .tm-row:focus-within .tm-row-actions { opacity: 1; }
.tm-row-title-static { cursor: default; }
.tm-row-selected { background: var(--dsw-alias-bg-layer-1); border-color: var(--dsw-alias-brand-primary); }
.tm-batch { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 9px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); font-size: 12px; }
.tm-batch-count { font-weight: 600; color: var(--dsw-alias-label-primary); white-space: nowrap; }
.tm-batch-hint { flex: 1; min-width: 160px; color: var(--dsw-alias-label-secondary); }
.tm-trash { display: flex; flex-direction: column; gap: 6px; }
.tm-trash-bar { display: flex; align-items: center; gap: 10px; padding: 0 4px 6px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.tm-trash-hint { flex: 1; }
.tm-trash-count { white-space: nowrap; }
.tm-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 48px 16px; text-align: center; color: var(--dsw-alias-label-secondary); }
.tm-empty-title { margin: 0; font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.tm-empty-hint { margin: 0; font-size: 12px; }
`

    /* 由 apply 注入的服务引用；组件通过闭包读取，避免把 ctx 传进渲染树。 */
    let localeService
    let remoteService
    let sessionsService
    let uiWorkspaceService

    return {
      inject: ['slots', 'locale', 'remote', 'remote.session', 'sessions', 'uiWorkspace'],
      apply(ctx) {
        localeService = ctx.locale
        remoteService = ctx.remote
        sessionsService = ctx.sessions
        uiWorkspaceService = ctx.uiWorkspace

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 30,
              label: () => translate('nav'),
            },
            TaskManagerIcon,
          ),
        )

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, TaskManagerPage),
        )
      },
    }
  },
})
