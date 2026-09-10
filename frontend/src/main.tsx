import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import 'katex/dist/katex.min.css'
// 样式分层：历史样式表 → 公共页面基础 → 设计基座（tokens/base/layout/components，最后加载以生效）
import './styles.css'
import './styles/foundation.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/components.css'
import './styles/shell.css'
// 页面级样式：按页面拆分，避免继续堆进单体 styles.css
import './styles/pages/problems.css'
import './styles/pages/problem.css'
import './styles/pages/home.css'
import './styles/pages/ranking.css'
import './styles/pages/status.css'
import './styles/pages/contest.css'
import './styles/pages/profile.css'
import './styles/pages/admin.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
