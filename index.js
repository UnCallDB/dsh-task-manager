/**
 * 任务管理 Host 半实现。
 *
 * 职责：
 * 1. 把任务持久化成一份 JSON（默认 `$DSH_HOME/task-manager/tasks.json`）；
 * 2. 把任务图片存成同目录 `images/<uuid>.<ext>` 的文件，并按需回读；
 * 3. 通过 `/task-manager/api` 暴露接口：`POST` 走 JSON 方法，`GET …/image/<file>` 回图片；
 * 4. 用 `ctx.connection.requestRejection()` 拒绝非本机 Peer 的请求。
 *
 * 「发送到项目并执行」发生在浏览器半实现：它调用已有的
 * `session.create` / `session.selectModel` / `session.prompt` Remote，
 * 本项目不重复实现会话能力。
 *
 * @module @local/dsh-task-manager
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** JSON 接口的固定路径；浏览器半实现按同一常量拼接。 */
const API_PATH = '/task-manager/api'
/** 图片读取路径前缀。 */
const IMAGE_ROUTE_PREFIX = `${API_PATH}/image/`
/** 请求体上限：图片走 base64，比纯文本大得多。 */
const MAX_BODY_BYTES = 12 * 1024 * 1024
/** 单张图片上限。 */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
/** 单条任务最多几张图。 */
const MAX_IMAGES = 6
/** 标题长度上限，避免把整篇文档粘成任务。 */
const MAX_TITLE_LENGTH = 2000
/** 工作区标题快照的长度上限（仅用于工作区已删除时的展示）。 */
const MAX_PROJECT_LABEL_LENGTH = 200
/** 存储格式版本；结构变化时递增。 */
const STATE_VERSION = 1
/** 回收站最多保留多少条，超出按最旧丢弃并删除其图片。 */
const MAX_TRASH = 200

/** 支持的图片类型与落盘扩展名。 */
const IMAGE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])

/** 扩展名到 Content-Type，供读取路由使用。 */
const EXTENSION_TYPES = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['gif', 'image/gif'],
])

/** 只接受本插件写出的图片文件名，杜绝路径穿越。 */
const IMAGE_FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|gif)$/
/** 只接受 UUID 形式的图片 id。 */
const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const inject = ['webServer', 'connection']

/**
 * 解析任务存储目录：优先使用 Harness 自己的 home 解析器，退回 `$DSH_HOME` / `~/.dsh`。
 * @param ctx - 插件上下文。
 * @returns 任务数据目录的绝对路径。
 */
function resolveDataDir(ctx) {
  const joinHome = ctx.get('dshHomePath')
  if (typeof joinHome === 'function') return joinHome('task-manager')
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return join(configured === '' ? join(homedir(), '.dsh') : configured, 'task-manager')
}

/** 只接受有限的数值时间戳。 */
function toTime(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 只接受非空字符串。 */
function toText(value, limit) {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text === '' ? undefined : text.slice(0, limit)
}

/** 空状态。 */
function emptyState() {
  return { version: STATE_VERSION, tasks: [], trash: [] }
}

/**
 * 收敛一张图片的元数据；无法识别时返回 undefined。
 * @param value - 未验证的图片记录。
 */
function normalizeImage(value) {
  const id = typeof value?.id === 'string' && IMAGE_ID.test(value.id) ? value.id : undefined
  const mediaType = IMAGE_TYPES.has(value?.mediaType) ? value.mediaType : undefined
  if (id === undefined || mediaType === undefined) return undefined
  const image = { id, mediaType }
  const name = toText(value.name, 160)
  if (name !== undefined) image.name = name
  const bytes = toTime(value.bytes, undefined)
  if (bytes !== undefined) image.bytes = bytes
  return image
}

/**
 * 收敛一份模型选择；空值表示「用默认模型」。
 * @param value - 未验证的模型记录。
 */
function normalizeModel(value) {
  const provider = toText(value?.provider, 120)
  const model = toText(value?.model, 200)
  if (provider === undefined || model === undefined) return undefined
  const selection = { provider, model }
  const reasoningEffort = toText(value.reasoningEffort, 60)
  if (reasoningEffort !== undefined) selection.reasoningEffort = reasoningEffort
  return selection
}

/**
 * 把磁盘上的一条记录收敛成已知形状；无法识别时返回 undefined，由调用方丢弃。
 * @param value - 未验证的记录。
 */
function normalizeTask(value) {
  if (typeof value !== 'object' || value === null) return undefined
  const id = toText(value.id, 120)
  const title = toText(value.title, MAX_TITLE_LENGTH)
  const createdAt = toTime(value.createdAt, undefined)
  if (id === undefined || title === undefined || createdAt === undefined) return undefined
  const task = {
    id,
    title,
    workspaceId: toText(value.workspaceId, 120) ?? null,
    workspaceTitle: toText(value.workspaceTitle, MAX_PROJECT_LABEL_LENGTH) ?? null,
    status: value.status === 'done' ? 'done' : 'todo',
    createdAt,
    updatedAt: toTime(value.updatedAt, createdAt),
    images: [],
    model: null,
  }
  if (Array.isArray(value.images)) {
    for (const entry of value.images) {
      const image = normalizeImage(entry)
      if (image !== undefined) task.images.push(image)
    }
  }
  const model = normalizeModel(value.model)
  if (model !== undefined) task.model = model
  const sentAt = toTime(value.sentAt, undefined)
  if (sentAt !== undefined) task.sentAt = sentAt
  const lastSessionId = toText(value.lastSessionId, 120)
  if (lastSessionId !== undefined) task.lastSessionId = lastSessionId
  return task
}

/**
 * 收敛一条回收站记录：它与任务同形，另外必须有删除时间。
 * @param value - 未验证的记录。
 */
function normalizeTrashEntry(value) {
  const task = normalizeTask(value)
  if (task === undefined) return undefined
  const deletedAt = toTime(value.deletedAt, undefined)
  if (deletedAt === undefined) return undefined
  return { ...task, deletedAt }
}

/** 把读取到的 JSON 收敛成状态。 */
function normalizeState(parsed) {
  const state = emptyState()
  const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : []
  for (const entry of tasks) {
    const task = normalizeTask(entry)
    if (task !== undefined) state.tasks.push(task)
  }
  const trash = Array.isArray(parsed?.trash) ? parsed.trash : []
  for (const entry of trash) {
    const trashed = normalizeTrashEntry(entry)
    if (trashed !== undefined && state.trash.length < MAX_TRASH) state.trash.push(trashed)
  }
  state.trash.sort((left, right) => right.deletedAt - left.deletedAt)
  return state
}

/** 校验一组图片元数据。 */
function readImages(value) {
  if (value === undefined || value === null) return { value: [] }
  if (!Array.isArray(value)) return { error: '图片列表格式不对' }
  if (value.length > MAX_IMAGES) return { error: `一条任务最多 ${MAX_IMAGES} 张图片` }
  const images = []
  for (const entry of value) {
    const image = normalizeImage(entry)
    if (image === undefined) return { error: '图片记录无法识别' }
    images.push(image)
  }
  return { value: images }
}

/** 校验「添加任务」的入参。 */
function readAddInput(body) {
  const title = toText(body?.title, MAX_TITLE_LENGTH)
  if (title === undefined) return { error: '任务内容不能为空' }
  const workspaceId = toText(body?.workspaceId, 120) ?? null
  const workspaceTitle = toText(body?.workspaceTitle, MAX_PROJECT_LABEL_LENGTH) ?? null
  const images = readImages(body?.images)
  if (images.error !== undefined) return { error: images.error }
  if (body?.model !== undefined && body.model !== null && normalizeModel(body.model) === undefined) {
    return { error: '模型选择无法识别' }
  }
  return {
    value: {
      title,
      workspaceId,
      workspaceTitle,
      images: images.value,
      model: normalizeModel(body?.model) ?? null,
    },
  }
}

/** 校验「修改任务」的入参，只接受允许修改的字段。 */
function readUpdateInput(body) {
  const id = toText(body?.id, 120)
  if (id === undefined) return { error: '缺少任务 id' }
  const patch = {}
  if (body?.title !== undefined) {
    const title = toText(body.title, MAX_TITLE_LENGTH)
    if (title === undefined) return { error: '任务内容不能为空' }
    patch.title = title
  }
  if (body?.status !== undefined) {
    if (body.status !== 'todo' && body.status !== 'done') return { error: '未知的任务状态' }
    patch.status = body.status
  }
  if (body?.workspaceId !== undefined) {
    patch.workspaceId = toText(body.workspaceId, 120) ?? null
    patch.workspaceTitle = toText(body?.workspaceTitle, MAX_PROJECT_LABEL_LENGTH) ?? null
  }
  if (body?.model !== undefined) {
    const model = body.model === null ? null : normalizeModel(body.model)
    if (body.model !== null && model === undefined) return { error: '模型选择无法识别' }
    patch.model = model
  }
  if (Object.keys(patch).length === 0) return { error: '没有可修改的字段' }
  return { value: { id, patch } }
}

/**
 * 读取请求体并解析 JSON；超过上限时拒绝而不是无限缓冲。
 * @param req - node:http 请求。
 * @returns 解析后的 JSON 值。
 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('请求体过大')
    chunks.push(buffer)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

/** 写出一个 JSON 响应。 */
function writeJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** 写出成功信封。 */
function writeOk(res, value) {
  writeJson(res, 200, { ok: true, value })
}

/** 业务失败：code 供浏览器半实现区分，message 直接展示给用户。 */
class TaskStoreError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/**
 * 把一条任务移入回收站，并裁掉超出上限的最旧条目。
 * @param current - 当前状态。
 * @param task - 要移入的任务。
 * @param deletedAt - 删除时间。
 * @returns 被裁掉条目的图片，由调用方在状态落盘后清理文件。
 */
function toTrash(current, task, deletedAt) {
  current.trash.unshift({ ...task, images: [...task.images], deletedAt })
  const dropped = []
  while (current.trash.length > MAX_TRASH) {
    const oldest = current.trash.pop()
    if (oldest !== undefined) dropped.push(...oldest.images)
  }
  return dropped
}

/**
 * 打开并管理任务存储。
 * @param ctx - 插件上下文，用于日志。
 * @param dataDir - 任务数据目录。
 */
function createTaskStore(ctx, dataDir) {
  const file = join(dataDir, 'tasks.json')
  const imagesDir = join(dataDir, 'images')
  let state
  let loading
  let queue = Promise.resolve()

  /** 读取磁盘状态，只读一次；损坏的文件会被改名保留，避免静默覆盖用户数据。 */
  async function load() {
    if (state !== undefined) return state
    if (loading !== undefined) return loading
    loading = (async () => {
      try {
        const text = await readFile(file, 'utf8')
        state = normalizeState(JSON.parse(text))
      } catch (error) {
        if (error?.code === 'ENOENT') {
          state = emptyState()
        } else if (error instanceof SyntaxError) {
          const backup = `${file}.corrupt-${Date.now()}`
          await rename(file, backup).catch(() => {})
          ctx.logger.warn(`task-manager: 任务文件无法解析，已备份为 ${backup}`)
          state = emptyState()
        } else {
          throw error
        }
      }
      return state
    })()
    return loading
  }

  /** 原子写入：先写同目录临时文件，再 rename 覆盖。 */
  async function save() {
    const temp = `${file}.${randomUUID()}.tmp`
    await mkdir(dataDir, { recursive: true, mode: 0o700 })
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, file)
  }

  /** 串行化所有写操作，避免并发请求互相覆盖；状态先落盘，再清理图片文件。 */
  function mutate(operation) {
    const run = queue.then(async () => {
      const current = await load()
      const { value, cleanup } = operation(current)
      await save()
      if (cleanup !== undefined) await dropImages(cleanup)
      return value
    })
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** 尽力删除一组图片文件；文件不在也不影响任务本身。 */
  async function dropImages(images) {
    const targets = Array.isArray(images) ? images : []
    for (const image of targets) {
      const extension = IMAGE_TYPES.get(image?.mediaType)
      if (extension === undefined) continue
      await unlink(join(imagesDir, `${image.id}.${extension}`)).catch(() => {})
    }
  }

  return {
    async list() {
      const current = await load()
      return {
        tasks: current.tasks.map((task) => ({ ...task })),
        trash: current.trash.map((task) => ({ ...task })),
      }
    },

    add(input) {
      return mutate((current) => {
        const now = Date.now()
        const task = {
          id: randomUUID(),
          title: input.title,
          workspaceId: input.workspaceId,
          workspaceTitle: input.workspaceTitle,
          status: 'todo',
          createdAt: now,
          updatedAt: now,
          images: input.images,
          model: input.model,
        }
        current.tasks.unshift(task)
        return { value: { task: { ...task } } }
      })
    },

    update(input) {
      return mutate((current) => {
        const task = current.tasks.find((entry) => entry.id === input.id)
        if (task === undefined) throw new TaskStoreError('not-found', '这条任务已经不存在了')
        Object.assign(task, input.patch, { updatedAt: Date.now() })
        return { value: { task: { ...task } } }
      })
    },

    remove(input) {
      return mutate((current) => {
        const index = current.tasks.findIndex((entry) => entry.id === input.id)
        if (index < 0) throw new TaskStoreError('not-found', '这条任务已经不存在了')
        const [removed] = current.tasks.splice(index, 1)
        const cleanup = toTrash(current, removed, Date.now())
        return { value: { removed: true }, cleanup }
      })
    },

    markSent(input) {
      return mutate((current) => {
        const task = current.tasks.find((entry) => entry.id === input.id)
        if (task === undefined) throw new TaskStoreError('not-found', '这条任务已经不存在了')
        const now = Date.now()
        task.sentAt = now
        task.lastSessionId = input.sessionId
        // 发送即视为处理完毕：不再留在待办里。
        task.status = 'done'
        task.updatedAt = now
        return { value: { task: { ...task } } }
      })
    },

    /** 多条任务一次性标记为已发送（合并发送到同一个会话）。 */
    markSentMany(input) {
      return mutate((current) => {
        const ids = new Set(input.ids)
        const now = Date.now()
        const tasks = []
        for (const task of current.tasks) {
          if (!ids.has(task.id)) continue
          task.sentAt = now
          task.lastSessionId = input.sessionId
          task.status = 'done'
          task.updatedAt = now
          tasks.push({ ...task })
        }
        return { value: { tasks } }
      })
    },

    clearDone() {
      return mutate((current) => {
        const before = current.tasks.length
        const cleanup = []
        const now = Date.now()
        current.tasks = current.tasks.filter((task) => {
          if (task.status !== 'done') return true
          cleanup.push(...toTrash(current, task, now))
          return false
        })
        return { value: { removed: before - current.tasks.length }, cleanup }
      })
    },

    /** 从回收站恢复一条任务，恢复后回到待办。 */
    restore(input) {
      return mutate((current) => {
        const index = current.trash.findIndex((entry) => entry.id === input.id)
        if (index < 0) throw new TaskStoreError('not-found', '回收站里没有这条任务')
        const [entry] = current.trash.splice(index, 1)
        const { deletedAt, ...task } = entry
        task.status = 'todo'
        task.updatedAt = Date.now()
        current.tasks.unshift(task)
        return { value: { task: { ...task } } }
      })
    },

    /** 彻底删除回收站里的一条任务，连带删除它的图片。 */
    purge(input) {
      return mutate((current) => {
        const index = current.trash.findIndex((entry) => entry.id === input.id)
        if (index < 0) throw new TaskStoreError('not-found', '回收站里没有这条任务')
        const [entry] = current.trash.splice(index, 1)
        return { value: { removed: true }, cleanup: entry.images }
      })
    },

    /** 清空回收站。 */
    emptyTrash() {
      return mutate((current) => {
        const cleanup = []
        for (const entry of current.trash) cleanup.push(...entry.images)
        const removed = current.trash.length
        current.trash = []
        return { value: { removed }, cleanup }
      })
    },

    /** 保存一张 base64 图片，返回它的元数据。 */
    async addImage(input) {
      const extension = IMAGE_TYPES.get(input.mediaType)
      if (extension === undefined) throw new TaskStoreError('bad-request', '不支持的图片格式')
      const data = typeof input.data === 'string' ? input.data : ''
      if (data === '') throw new TaskStoreError('bad-request', '图片内容为空')
      const bytes = Buffer.from(data, 'base64')
      if (bytes.length === 0) throw new TaskStoreError('bad-request', '图片内容无法解码')
      if (bytes.length > MAX_IMAGE_BYTES) {
        throw new TaskStoreError('too-large', `图片不能超过 ${Math.round(MAX_IMAGE_BYTES / 1048576)} MB`)
      }
      const id = randomUUID()
      await mkdir(imagesDir, { recursive: true, mode: 0o700 })
      await writeFile(join(imagesDir, `${id}.${extension}`), bytes, { mode: 0o600 })
      const image = { id, mediaType: input.mediaType, bytes: bytes.length }
      const name = toText(input.name, 160)
      if (name !== undefined) image.name = name
      return { image }
    },

    /** 删除一张还没被任务引用的图片（编辑器里移除缩略图时调用）。 */
    async removeImage(input) {
      const id = typeof input.id === 'string' && IMAGE_ID.test(input.id) ? input.id : undefined
      if (id === undefined) throw new TaskStoreError('bad-request', '缺少图片 id')
      for (const extension of EXTENSION_TYPES.keys()) {
        await unlink(join(imagesDir, `${id}.${extension}`)).catch(() => {})
      }
      return { removed: true }
    },

    /** 读取一张图片的字节与类型；不存在时返回 undefined。 */
    async readImage(filename) {
      if (!IMAGE_FILENAME.test(filename)) return undefined
      const extension = filename.slice(filename.lastIndexOf('.') + 1)
      const mediaType = EXTENSION_TYPES.get(extension)
      if (mediaType === undefined) return undefined
      try {
        const bytes = await readFile(join(imagesDir, filename))
        return { bytes, mediaType }
      } catch {
        return undefined
      }
    },
  }
}

/**
 * 处理 `/task-manager/api` 下的 JSON 请求。
 * @param store - 任务存储。
 * @param req - node:http 请求。
 * @param res - node:http 响应。
 */
async function handleApi(store, req, res) {
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: { code: 'method', message: '只接受 POST' } })
    return
  }
  let body
  try {
    body = await readJsonBody(req)
  } catch (error) {
    writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: error.message } })
    return
  }
  const method = typeof body?.method === 'string' ? body.method : ''
  try {
    switch (method) {
      case 'list':
        writeOk(res, await store.list())
        return
      case 'add': {
        const input = readAddInput(body)
        if (input.error !== undefined) throw new TaskStoreError('bad-request', input.error)
        writeOk(res, await store.add(input.value))
        return
      }
      case 'update': {
        const input = readUpdateInput(body)
        if (input.error !== undefined) throw new TaskStoreError('bad-request', input.error)
        writeOk(res, await store.update(input.value))
        return
      }
      case 'remove': {
        const id = typeof body?.id === 'string' ? body.id : ''
        if (id === '') throw new TaskStoreError('bad-request', '缺少任务 id')
        writeOk(res, await store.remove({ id }))
        return
      }
      case 'markSent': {
        const id = typeof body?.id === 'string' ? body.id : ''
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
        if (id === '' || sessionId === '') throw new TaskStoreError('bad-request', '缺少任务或会话 id')
        writeOk(res, await store.markSent({ id, sessionId }))
        return
      }
      case 'markSentMany': {
        const ids = Array.isArray(body?.ids)
          ? body.ids.filter((id) => typeof id === 'string' && id !== '')
          : []
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
        if (ids.length === 0 || sessionId === '') {
          throw new TaskStoreError('bad-request', '缺少任务或会话 id')
        }
        if (ids.length > 50) throw new TaskStoreError('bad-request', '一次最多合并 50 条任务')
        writeOk(res, await store.markSentMany({ ids, sessionId }))
        return
      }
      case 'clearDone':
        writeOk(res, await store.clearDone())
        return
      case 'restore': {
        const id = typeof body?.id === 'string' ? body.id : ''
        if (id === '') throw new TaskStoreError('bad-request', '缺少任务 id')
        writeOk(res, await store.restore({ id }))
        return
      }
      case 'purge': {
        const id = typeof body?.id === 'string' ? body.id : ''
        if (id === '') throw new TaskStoreError('bad-request', '缺少任务 id')
        writeOk(res, await store.purge({ id }))
        return
      }
      case 'emptyTrash':
        writeOk(res, await store.emptyTrash())
        return
      case 'addImage':
        writeOk(res, await store.addImage(body))
        return
      case 'removeImage':
        writeOk(res, await store.removeImage(body))
        return
      default:
        throw new TaskStoreError('unknown-method', `未知的接口方法 "${method}"`)
    }
  } catch (error) {
    if (error instanceof TaskStoreError) {
      writeJson(res, error.code === 'not-found' ? 404 : 400, {
        ok: false,
        error: { code: error.code, message: error.message },
      })
      return
    }
    throw error
  }
}

/**
 * 回读一张任务图片。
 * @param store - 任务存储。
 * @param filename - 图片文件名（`<uuid>.<ext>`）。
 * @param res - node:http 响应。
 */
async function serveImage(store, filename, res) {
  const image = await store.readImage(filename)
  if (image === undefined) {
    writeJson(res, 404, { ok: false, error: { code: 'not-found', message: '图片不存在' } })
    return
  }
  res.writeHead(200, {
    'content-type': image.mediaType,
    'content-length': image.bytes.length,
    'cache-control': 'private, max-age=31536000, immutable',
  })
  res.end(image.bytes)
}

/**
 * 插件入口：注册路由并在卸载时释放。
 * @param ctx - 插件上下文。
 */
export function apply(ctx) {
  const store = createTaskStore(ctx, resolveDataDir(ctx))

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PATH,
        handler: async (req, res) => {
          const rejection = ctx.connection.requestRejection(req)
          if (rejection !== undefined) {
            writeJson(res, rejection, {
              ok: false,
              error: { code: 'forbidden', message: '这个请求没有通过连接信任校验' },
            })
            return
          }
          const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
          try {
            if (pathname.startsWith(IMAGE_ROUTE_PREFIX)) {
              if (req.method !== 'GET' && req.method !== 'HEAD') {
                writeJson(res, 405, { ok: false, error: { code: 'method', message: '只接受 GET' } })
                return
              }
              await serveImage(store, pathname.slice(IMAGE_ROUTE_PREFIX.length), res)
              return
            }
            if (pathname !== API_PATH) {
              writeJson(res, 404, { ok: false, error: { code: 'not-found', message: '没有这个接口' } })
              return
            }
            await handleApi(store, req, res)
          } catch (error) {
            ctx.logger.warn(`task-manager: 接口处理失败 ${error instanceof Error ? error.message : String(error)}`)
            if (!res.headersSent) {
              writeJson(res, 500, {
                ok: false,
                error: { code: 'internal', message: '任务存储处理失败' },
              })
            } else {
              res.destroy()
            }
          }
        },
      }),
    'task-manager: /task-manager/api 路由',
  )
}
