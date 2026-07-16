'use client'

import { createContext, useContext } from 'react'
import { COLORS } from '@/lib/colors'
import { truncatePath } from '@/lib/utils'

// Context for file-open callback — provided by parent components
type OpenFileCallback = (filePath: string, line?: number) => void
const OpenFileContext = createContext<OpenFileCallback | null>(null)
export const OpenFileProvider = OpenFileContext.Provider

interface ToolContentRendererProps {
  toolName: string
  inputData?: Record<string, unknown>
  args?: string
  compact?: boolean  // shorter rendering for inline chat
}

export function ToolContentRenderer({ toolName, inputData, args, compact = false }: ToolContentRendererProps) {
  if (!inputData) {
    return <span className="opacity-60">{args || toolName}</span>
  }

  switch (toolName) {
    case 'Edit':
      return <EditContent data={inputData} compact={compact} />
    case 'TodoWrite':
      return <TodoContent data={inputData} />
    case 'Bash':
      return <BashContent data={inputData} compact={compact} />
    case 'Write':
      return <WriteContent data={inputData} compact={compact} />
    case 'Read':
      return <ReadContent data={inputData} />
    case 'Grep':
      return <GrepContent data={inputData} />
    case 'Glob':
      return <GlobContent data={inputData} />
    case 'WebSearch':
      return <WebSearchContent data={inputData} />
    case 'WebFetch':
      return <WebFetchContent data={inputData} />
    case 'AskUserQuestion':
      return <AskUserContent data={inputData} />
    default:
      return <span className="opacity-60">{args || toolName}</span>
  }
}

function FilePath({ path: filePath }: { path: string }) {
  const openFile = useContext(OpenFileContext)
  if (!filePath) return null
  const short = truncatePath(filePath)
  return (
    <div
      className={`text-[9px] mb-1 truncate ${openFile ? 'hover:underline' : ''}`}
      style={{ color: openFile ? COLORS.filePathActive : COLORS.filePathInactive, cursor: openFile ? 'pointer' : undefined }}
      onClick={openFile ? () => openFile(filePath) : undefined}
      title={openFile ? filePath : undefined}
    >
      {short}
    </div>
  )
}

function EditContent({ data, compact }: { data: Record<string, unknown>; compact: boolean }) {
  const filePath = String(data.file_path || '')
  const oldStr = String(data.old_string || '')
  const newStr = String(data.new_string || '')
  const maxLines = compact ? 4 : 8

  const oldLines = oldStr.split('\n').slice(0, maxLines)
  const newLines = newStr.split('\n').slice(0, maxLines)

  return (
    <div>
      <FilePath path={filePath} />
      <div className="rounded overflow-hidden text-[9px] font-mono leading-snug" style={{ background: COLORS.codeBlockBg }}>
        {oldLines.map((line, i) => (
          <div key={`old-${i}`} className="px-1.5 py-px" style={{ color: COLORS.diffRemoved, background: COLORS.diffRemovedBg }}>
            <span className="opacity-50 mr-1">-</span>{line || ' '}
          </div>
        ))}
        {oldStr.split('\n').length > maxLines && (
          <div className="px-1.5 py-px opacity-50" style={{ color: COLORS.diffRemoved }}>...</div>
        )}
        {newLines.map((line, i) => (
          <div key={`new-${i}`} className="px-1.5 py-px" style={{ color: COLORS.diffAdded, background: COLORS.diffAddedBg }}>
            <span className="opacity-50 mr-1">+</span>{line || ' '}
          </div>
        ))}
        {newStr.split('\n').length > maxLines && (
          <div className="px-1.5 py-px opacity-50" style={{ color: COLORS.diffAdded }}>...</div>
        )}
      </div>
    </div>
  )
}

interface TodoItem {
  content: string
  status: string
  activeForm?: string
}

function isTodoArray(v: unknown): v is TodoItem[] {
  return Array.isArray(v) && v.every(t => t && typeof t === 'object' && 'content' in t)
}

function TodoContent({ data }: { data: Record<string, unknown> }) {
  if (!isTodoArray(data.todos)) return null
  const todos = data.todos

  return (
    <div className="space-y-0.5">
      {todos.map((todo, i) => {
        const icon = todo.status === 'completed' ? '✓' :
          todo.status === 'in_progress' ? '●' : '○'
        const color = todo.status === 'completed' ? COLORS.todoCompleted :
          todo.status === 'in_progress' ? COLORS.tool_calling : COLORS.todoPending

        return (
          <div key={i} className="flex items-start gap-1.5 text-[10px] font-mono">
            <span style={{ color, flexShrink: 0 }}>{icon}</span>
            <span style={{
              color: todo.status === 'completed' ? COLORS.todoCompletedText : COLORS.assistantText,
              textDecoration: todo.status === 'completed' ? 'line-through' : 'none',
              opacity: todo.status === 'completed' ? 0.6 : 1,
            }}>
              {todo.content}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function BashContent({ data, compact }: { data: Record<string, unknown>; compact: boolean }) {
  const command = String(data.command || '')
  const description = String(data.description || '')
  const maxLen = compact ? 120 : 300

  return (
    <div>
      {description && (
        <div className="text-[9px] mb-1 opacity-60" style={{ color: COLORS.assistantText }}>{description}</div>
      )}
      <div className="rounded px-1.5 py-1 text-[9px] font-mono" style={{ background: COLORS.codeBlockBg, color: COLORS.tool_calling }}>
        <span className="opacity-55 mr-1">$</span>
        {command.length > maxLen ? command.slice(0, maxLen) + '...' : command}
      </div>
    </div>
  )
}

function WriteContent({ data, compact }: { data: Record<string, unknown>; compact: boolean }) {
  const filePath = String(data.file_path || '')
  const content = String(data.content || '')
  const maxLines = compact ? 4 : 8
  const lines = content.split('\n').slice(0, maxLines)

  return (
    <div>
      <FilePath path={filePath} />
      <div className="rounded px-1.5 py-1 text-[9px] font-mono leading-snug" style={{ background: COLORS.codeBlockBg, color: COLORS.contentDim }}>
        {lines.map((line, i) => (
          <div key={i} className="truncate">{line || ' '}</div>
        ))}
        {content.split('\n').length > maxLines && (
          <div className="opacity-50">...</div>
        )}
      </div>
    </div>
  )
}

function ReadContent({ data }: { data: Record<string, unknown> }) {
  const filePath = String(data.file_path || '')
  const offset = typeof data.offset === 'number' ? data.offset : undefined
  const limit = typeof data.limit === 'number' ? data.limit : undefined

  return (
    <div>
      <FilePath path={filePath} />
      {(offset != null || limit != null) && (
        <div className="text-[9px] opacity-50" style={{ color: COLORS.assistantText }}>
          {offset ? `from line ${offset}` : ''}{offset && limit ? ', ' : ''}{limit ? `${limit} lines` : ''}
        </div>
      )}
    </div>
  )
}

function GrepContent({ data }: { data: Record<string, unknown> }) {
  const pattern = String(data.pattern || '')
  const searchPath = String(data.path || '')
  const glob = typeof data.glob === 'string' ? data.glob : undefined

  return (
    <div className="text-[9px] font-mono">
      <span style={{ color: COLORS.tool_calling }}>{pattern}</span>
      {searchPath && <span className="opacity-55 ml-1">in {truncatePath(searchPath, 2)}</span>}
      {glob && <span className="opacity-55 ml-1">({glob})</span>}
    </div>
  )
}

function GlobContent({ data }: { data: Record<string, unknown> }) {
  const pattern = String(data.pattern || '')
  const searchPath = String(data.path || '')

  return (
    <div className="text-[9px] font-mono">
      <span style={{ color: COLORS.tool_calling }}>{pattern}</span>
      {searchPath && <span className="opacity-55 ml-1">in {truncatePath(searchPath, 2)}</span>}
    </div>
  )
}

function WebSearchContent({ data }: { data: Record<string, unknown> }) {
  const query = String(data.query || '')

  return (
    <div className="rounded px-1.5 py-1 text-[10px] font-mono flex items-center gap-1.5" style={{ background: COLORS.codeBlockBg }}>
      <span style={{ color: COLORS.searchIcon }}>🔍</span>
      <span style={{ color: COLORS.assistantText }}>{query}</span>
    </div>
  )
}

function WebFetchContent({ data }: { data: Record<string, unknown> }) {
  const url = String(data.url || '')
  const prompt = String(data.prompt || '')
  let displayUrl = url
  try { const u = new URL(url); displayUrl = u.hostname + u.pathname.slice(0, 50) } catch { /* keep full */ }

  return (
    <div>
      <div className="rounded px-1.5 py-1 text-[9px] font-mono truncate" style={{ background: COLORS.codeBlockBg, color: COLORS.filePathActive }}>
        🌐 {displayUrl}
      </div>
      {prompt && (
        <div className="mt-1 text-[9px] opacity-50 truncate" style={{ color: COLORS.assistantText }}>
          {prompt.slice(0, 120)}
        </div>
      )}
    </div>
  )
}

function AskUserContent({ data }: { data: Record<string, unknown> }) {
  const questions = Array.isArray(data.questions) ? data.questions as Array<{ question?: string; options?: string[] }> : undefined
  if (!questions || questions.length === 0) return null

  return (
    <div className="space-y-1.5">
      {questions.map((q, i) => (
        <div key={i}>
          <div className="text-[10px] font-mono mb-0.5" style={{ color: COLORS.tool_calling }}>
            {q.question}
          </div>
          {Array.isArray(q.options) && q.options.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {q.options.map((opt, j) => (
                <span
                  key={j}
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: COLORS.glassHighlight, border: `1px solid ${COLORS.glassBorder}`, color: COLORS.contentDim }}
                >
                  {opt}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
