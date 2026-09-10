import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// 开发期 API 代理目标。
// 注意：本机 8080 被 National Instruments 的 NI Application Web Server 服务占用，
// 因此后端默认监听 8090（见 scripts/dev-server.ps1 与 .env 的 HTTP_PORT）。
// 需要换端口：在 frontend/.env.local 里写 VITE_API_TARGET=http://localhost:8080。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const apiTarget = env.VITE_API_TARGET || 'http://localhost:8090'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
      watch: {
        // 编辑器/工具链的原子写会先生成 *.tmpdir/*.tmp 再改名；Vite 监视这些临时文件会
        // 因 EBUSY 抛错并直接退出进程，因此显式忽略它们。
        ignored: ['**/.tmpdir/**', '**/*.tmp', '**/.*.tmpdir/**', '**/dist/**'],
      },
    },
    build: {
      // monaco-editor 体积较大，单独拆包以便浏览器缓存；主包保持轻量
      rollupOptions: {
        output: {
          manualChunks: {
            monaco: ['monaco-editor', '@monaco-editor/react'],
          },
        },
      },
      chunkSizeWarningLimit: 1500,
    },
  }
})
