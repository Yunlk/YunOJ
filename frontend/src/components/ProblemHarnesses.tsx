import { useMemo, useState } from 'react'
import type { ProblemHarness } from '../types'
import { PLACEHOLDER_HINT, harnessProblems, makeDefaultHarness } from '../utils/harness'

interface ProblemHarnessesProps {
  /** 当前题目的语言模板（受控） */
  value: Record<string, ProblemHarness>
  onChange: (next: Record<string, ProblemHarness>) => void
  /** 可选语言（来自后端的语言注册表） */
  languages: { key: string; name: string; monaco: string }[]
}

/**
 * 函数题的语言模板编辑器。
 *
 * 每种语言一份「驱动模板 + 初始代码」：
 *   - 驱动模板负责读入、调用选手函数、输出，用 {{code}} 标记选手代码位置；
 *   - 初始代码是选手打开编辑器时看到的骨架（函数签名 + 注释）。
 * 只有配了模板的语言才能被选手提交（没有模板的语言在评测时会明确报错）。
 */
export default function ProblemHarnesses({ value, onChange, languages }: ProblemHarnessesProps) {
  const keys = useMemo(() => Object.keys(value).sort(), [value])
  const [active, setActive] = useState('')
  // 选中的语言：优先当前激活项，否则第一个已配置语言，再否则第一个可用语言
  const current = keys.includes(active) ? active : keys[0] ?? languages[0]?.key ?? ''

  const setHarness = (language: string, patch: Partial<ProblemHarness>) => {
    const base = value[language] ?? { template: '', initial_code: '' }
    onChange({ ...value, [language]: { ...base, ...patch } })
  }

  const addLanguage = (language: string) => {
    if (value[language]) {
      setActive(language)
      return
    }
    onChange({ ...value, [language]: makeDefaultHarness(language) })
    setActive(language)
  }

  const removeLanguage = (language: string) => {
    const next = { ...value }
    delete next[language]
    onChange(next)
  }

  const problems = harnessProblems(value)
  const editor = value[current]
  const languageName = languages.find((l) => l.key === current)?.name ?? current

  return (
    <fieldset className="form-group admin-fieldset harness-fieldset">
      <legend className="field-label">函数题语言模板</legend>
      <p className="field-hint">
        选手只写函数体；驱动模板负责读入、调用与输出。模板里的 <code>{'{{code}}'}</code> 会被替换成选手代码，
        因此模板必须包含该占位符。若选手提交了自带 <code>main</code> 的完整程序，则按完整程序评测。
      </p>

      {languages.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-title">语言列表加载中</p>
        </div>
      ) : (
        <>
          <div className="harness-toolbar">
            <div className="harness-langs" role="tablist" aria-label="函数题语言">
              {keys.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={key === current}
                  className={`tab${key === current ? ' active' : ''}`}
                  onClick={() => setActive(key)}
                >
                  {languages.find((l) => l.key === key)?.name ?? key}
                  {harnessProblems({ [key]: value[key] }).length > 0 && (
                    <span className="tab-count harness-tab-bad" title="该语言模板有问题">
                      !
                    </span>
                  )}
                </button>
              ))}
            </div>
            <select
              className="select-input harness-add"
              aria-label="添加语言模板"
              value=""
              onChange={(e) => {
                if (e.target.value) addLanguage(e.target.value)
              }}
            >
              <option value="">＋ 添加语言…</option>
              {languages
                .filter((l) => !value[l.key])
                .map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.name}
                  </option>
                ))}
            </select>
          </div>

          {keys.length === 0 && (
            <div className="warning-message">
              函数题至少要配置一种语言的模板，否则没有选手能提交这道题。
            </div>
          )}

          {editor && (
            <div className="harness-editor">
              <div className="form-group">
                <div className="label-row">
                  <label htmlFor="h-template">{languageName} · 驱动模板</label>
                  <button
                    type="button"
                    className="button button-ghost button-sm"
                    onClick={() => removeLanguage(current)}
                  >
                    移除该语言
                  </button>
                </div>
                <textarea
                  id="h-template"
                  className="code-editor-textarea"
                  value={editor.template}
                  onChange={(e) => setHarness(current, { template: e.target.value })}
                  placeholder={`#include <bits/stdc++.h>\nusing namespace std;\n\n// 选手的函数写在这里\n{{code}}\n\nint main() {\n    int a, b;\n    cin >> a >> b;\n    cout << solve(a, b) << endl;\n    return 0;\n}`}
                />
                {!editor.template.includes('{{code}}') && (
                  <p className="error-message">{PLACEHOLDER_HINT}</p>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="h-initial">{languageName} · 初始代码（选手编辑器预填）</label>
                <textarea
                  id="h-initial"
                  className="code-editor-textarea"
                  value={editor.initial_code}
                  onChange={(e) => setHarness(current, { initial_code: e.target.value })}
                  placeholder={'int solve(int a, int b) {\n    // TODO: 在这里实现\n    \n}'}
                />
                <p className="field-hint">
                  这段会出现在选手的编辑器里（即函数签名与注释）—— 选手打开题目就该看到「函数的样子」。
                </p>
                {!editor.initial_code.trim() && (
                  <p className="error-message">初始代码不能为空，否则选手打开编辑器是空白的。</p>
                )}
              </div>
            </div>
          )}

          {problems.length > 0 && keys.length > 0 && (
            <div className="error-message">
              <ul className="harness-problems">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </fieldset>
  )
}
