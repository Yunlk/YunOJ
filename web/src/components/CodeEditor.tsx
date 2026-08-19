import Editor, { loader } from '@monaco-editor/react'
import { monaco } from '../monacoSetup'

// 让 @monaco-editor/react 使用本地打包的 monaco（而非默认的 CDN 加载器）
loader.config({ monaco })

export interface CursorPosition {
  line: number
  column: number
}

interface CodeEditorProps {
  /** OJ 语言 key：cpp / c / python */
  language: string
  value: string
  onChange: (value: string) => void
  onCtrlEnter?: () => void
  onCursorChange?: (pos: CursorPosition) => void
  fontSize?: number
}

// OJ 语言 key → Monaco 语言 id
const monacoLanguage: Record<string, string> = {
  cpp: 'cpp',
  c: 'c',
  python: 'python',
}

// 基于 Monaco（VS Code 同款编辑器）的在线 IDE：
// 各语言语法高亮与自动缩进规则（C 系花括号 / Python 冒号）、
// 括号自动补全、括号匹配高亮、查找替换等。
export default function CodeEditor({
  language,
  value,
  onChange,
  onCtrlEnter,
  onCursorChange,
  fontSize = 14,
}: CodeEditorProps) {
  return (
    <div className="code-editor-wrap">
      <Editor
        height="100%"
        width="100%"
        language={monacoLanguage[language] ?? 'plaintext'}
        value={value}
        theme="yunoj-calm"
        onChange={(v) => onChange(v ?? '')}
        onMount={(editor, m) => {
          // Ctrl/Cmd + Enter 快速提交
          editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, () => onCtrlEnter?.())
          // 光标位置上报（状态栏 Ln/Col）
          editor.onDidChangeCursorPosition((e) => {
            onCursorChange?.({ line: e.position.lineNumber, column: e.position.column })
          })
        }}
        options={{
          minimap: { enabled: false },
          fontSize,
          tabSize: 4,
          insertSpaces: true,
          detectIndentation: false,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: 'off',
          renderLineHighlight: 'all',
          cursorBlinking: 'solid',
          padding: { top: 10 },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          smoothScrolling: true,
          fontLigatures: true,
          bracketPairColorization: { enabled: false },
        }}
        loading={<div className="page-loading">编辑器加载中…</div>}
      />
    </div>
  )
}
