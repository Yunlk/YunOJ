import Markdown from './Markdown'
import type { ProblemDetail, Sample } from '../types'
import { copyText } from '../utils/clipboard'

interface ProblemStatementProps {
  problem: ProblemDetail
  onRunSample?: (sample: Sample) => void
}

export default function ProblemStatement({ problem, onRunSample }: ProblemStatementProps) {
  return (
    <>
      {problem.statement && (
        <section className="section">
          <h2 className="section-title">题目描述</h2>
          <Markdown>{problem.statement}</Markdown>
        </section>
      )}
      {problem.input_format && (
        <section className="section">
          <h2 className="section-title">输入格式</h2>
          <Markdown>{problem.input_format}</Markdown>
        </section>
      )}
      {problem.output_format && (
        <section className="section">
          <h2 className="section-title">输出格式</h2>
          <Markdown>{problem.output_format}</Markdown>
        </section>
      )}
      {problem.samples.length > 0 && (
        <section className="section">
          <h2 className="section-title">输入输出样例</h2>
          <div className="samples-grid">
            {problem.samples.map((sample, index) => (
              <div key={index} className="sample-panel-group">
                <div className="sample-panel">
                  <div className="sample-panel-head">
                    <span className="sample-panel-title">输入 #{index + 1}</span>
                    <span className="sample-panel-actions">
                      {onRunSample && (
                        <button type="button" className="mini-btn" onClick={() => onRunSample(sample)}>
                          运行
                        </button>
                      )}
                      <button type="button" className="mini-btn" onClick={() => void copyText(sample.input)}>
                        复制
                      </button>
                    </span>
                  </div>
                  <pre className="sample-panel-content">{sample.input}</pre>
                </div>
                <div className="sample-panel">
                  <div className="sample-panel-head">
                    <span className="sample-panel-title">输出 #{index + 1}</span>
                    <span className="sample-panel-actions">
                      {onRunSample && (
                        <button type="button" className="mini-btn" onClick={() => onRunSample(sample)}>
                          运行
                        </button>
                      )}
                      <button type="button" className="mini-btn" onClick={() => void copyText(sample.output)}>
                        复制
                      </button>
                    </span>
                  </div>
                  <pre className="sample-panel-content">{sample.output}</pre>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {problem.hint && (
        <section className="section">
          <h2 className="section-title">说明 / 提示</h2>
          <Markdown>{problem.hint}</Markdown>
        </section>
      )}
    </>
  )
}
