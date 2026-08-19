import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** 全局错误边界：渲染崩溃时显示错误信息而非白屏，便于定位问题。 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('页面渲染错误：', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <h2>页面出错了</h2>
          <p className="muted">发生了未预期的渲染错误，请把下面的信息反馈给管理员。</p>
          <pre className="error-boundary-detail">{this.state.error.message}</pre>
          <div>
            <button type="button" className="button button-primary" onClick={() => window.location.reload()}>
              重新加载
            </button>
            <button type="button" className="button button-secondary" onClick={() => this.setState({ error: null })}>
              忽略并继续
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
