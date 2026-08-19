import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import AdminRoute from './components/AdminRoute'
import ErrorBoundary from './components/ErrorBoundary'
import Navbar from './components/Navbar'
import ProtectedRoute from './components/ProtectedRoute'
import ContestDetail from './pages/ContestDetail'
import ContestForm from './pages/ContestForm'
import ContestList from './pages/ContestList'
import ContestMySubmissions from './pages/ContestMySubmissions'
import ContestProblemPage from './pages/ContestProblemPage'
import ContestProblemManagerPage from './pages/ContestProblemManagerPage'
import ContestStandingsPage from './pages/ContestStandingsPage'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import ProblemAdmin from './pages/ProblemAdmin'
import ProblemDetail from './pages/ProblemDetail'
import ProblemForm from './pages/ProblemForm'
import ProblemList from './pages/ProblemList'
import Register from './pages/Register'
import Status from './pages/Status'
import SubmissionDetail from './pages/SubmissionDetail'
import SubmitFile from './pages/SubmitFile'
import TestcaseAdmin from './pages/TestcaseAdmin'

/** 常规布局：导航栏 + 内容容器。 */
function AppLayout() {
  const location = useLocation()
  const dynamicStandings = location.pathname.endsWith('/standings/dynamic')

  return (
    <>
      {!dynamicStandings && <Navbar />}
      <main className={dynamicStandings ? 'dynamic-standings-page' : 'container'}>
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<ProblemList />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/status" element={<Status />} />
            <Route path="/contests" element={<ContestList />} />
            <Route path="/contest/new" element={<AdminRoute><ContestForm /></AdminRoute>} />
            <Route path="/contest/:id" element={<ContestDetail />} />
            <Route path="/contest/:id/edit" element={<AdminRoute><ContestForm /></AdminRoute>} />
            <Route path="/contest/:id/problem/:pid" element={<ProtectedRoute><ContestProblemPage /></ProtectedRoute>} />
            <Route path="/contest/:id/problems" element={<AdminRoute><ContestProblemManagerPage /></AdminRoute>} />
            <Route path="/contest/:id/submissions" element={<ProtectedRoute><ContestMySubmissions /></ProtectedRoute>} />
            <Route path="/contest/:id/standings" element={<ContestStandingsPage />} />
            <Route path="/contest/:id/standings/dynamic" element={<ContestStandingsPage />} />
            <Route path="/admin/problems" element={<AdminRoute><ProblemAdmin /></AdminRoute>} />
            <Route path="/admin/problems/:id/tests" element={<AdminRoute><TestcaseAdmin /></AdminRoute>} />
            <Route path="/problem/new" element={<AdminRoute><ProblemForm /></AdminRoute>} />
            <Route path="/problem/:id" element={<ProblemDetail />} />
            <Route path="/problem/:id/edit" element={<AdminRoute><ProblemForm /></AdminRoute>} />
            <Route path="/problem/:id/submit-file" element={<ProtectedRoute><SubmitFile /></ProtectedRoute>} />
            <Route path="/submission/:id" element={<ProtectedRoute><SubmissionDetail /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  )
}
