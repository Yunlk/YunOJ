// Monaco Editor 的 Vite 集成：worker 本地打包，不依赖任何 CDN。
// 注意：本文件必须先于任何 Editor 组件渲染被 import（在 CodeEditor.tsx 顶部）。
import * as monaco from 'monaco-editor'
// 注意：monaco-editor 0.5x 的 package exports 会自动补全 esm/vs 前缀，
// 导入路径不可再写 esm/vs 段。
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker'

// C/C++/Python 用的是基础语法高亮（Monarch 词法，无独立语言服务），
// 只需要核心编辑器 worker。
self.MonacoEnvironment = {
  getWorker: () => new editorWorker(),
} as monaco.Environment

// 自定义浅色主题：冷静克制的 GitHub 风格配色。
// 只用两三种低饱和颜色——关键字深蓝、字符串深海军蓝、注释灰色，
// 其余一律中性深灰；高亮/边框等界面元素都是极浅的灰。
monaco.editor.defineTheme('yunoj-calm', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6e7781', fontStyle: 'italic' },
    { token: 'keyword', foreground: '0550ae' },
    { token: 'keyword.flow', foreground: '0550ae' },
    { token: 'keyword.directive', foreground: '6e7781' },
    { token: 'string', foreground: '0a3069' },
    { token: 'string.escape', foreground: '1f2328' },
    { token: 'number', foreground: '0550ae' },
    { token: 'identifier', foreground: '1f2328' },
    { token: 'type', foreground: '1f2328' },
    { token: 'predefined', foreground: '1f2328' },
    { token: 'function', foreground: '1f2328' },
    { token: 'delimiter', foreground: '1f2328' },
    { token: 'delimiter.bracket', foreground: '1f2328' },
    { token: 'operator', foreground: '1f2328' },
    { token: 'constant', foreground: '0550ae' },
    { token: 'variable', foreground: '1f2328' },
    { token: 'tag', foreground: '116329' },
    { token: 'attribute.name', foreground: '0550ae' },
    { token: 'attribute.value', foreground: '0a3069' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#1f2328',
    'editorCursor.foreground': '#1f2328',
    'editor.lineHighlightBackground': '#eaf1fb',
    'editor.lineHighlightBorder': '#d9e6f8',
    'editor.selectionBackground': '#ddf4ff',
    'editor.inactiveSelectionBackground': '#eaeef2',
    'editorLineNumber.foreground': '#8c959f',
    'editorLineNumber.activeForeground': '#1f2328',
    'editorIndentGuide.background': '#f0f3f5',
    'editorIndentGuide.activeBackground': '#c9d1d9',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#d0d7de',
    'editorSuggestWidget.background': '#ffffff',
    'editorSuggestWidget.border': '#d0d7de',
    'editorSuggestWidget.selectedBackground': '#eaeef2',
    'editorHoverWidget.background': '#ffffff',
    'editorHoverWidget.border': '#d0d7de',
    'editor.findMatchBackground': '#fff8c5',
    'editor.findMatchHighlightBackground': '#fff8c588',
    'editorBracketMatch.background': '#eaeef2',
    'editorBracketMatch.border': '#c9d1d9',
    'editorWhitespace.foreground': '#eaeef2',
    'input.background': '#ffffff',
    'input.border': '#d0d7de',
    'scrollbarSlider.background': '#d0d7de66',
    'scrollbarSlider.hoverBackground': '#afb8c199',
    'scrollbarSlider.activeBackground': '#8c959f99',
    'minimap.background': '#ffffff',
  },
})

export { monaco }
