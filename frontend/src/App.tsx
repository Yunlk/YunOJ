import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import AdminRoute from './components/AdminRoute'
import ErrorBoundary from './components/ErrorBoundary'
import Navbar from './components/Navbar'
import ProtectedRoute from './components/ProtectedRoute'
import ContestDetail from './pages/ContestDetail'
import ContestForm from './pages/ContestForm'
import ContestList from './pages/ContestList'
import ContestMessagesPage from './pages/ContestMessagesPage'
import ContestMySubmissions from './pages/ContestMySubmissions'
import ContestProblemPage from './pages/ContestProblemPage'
import ContestStandingsPage from './pages/ContestStandingsPage'
import ContestBroadcastGuard from './components/ContestBroadcastGuard'
import Home from './pages/Home'
import AdminUsers from './pages/AdminUsers'
import Groups from './pages/Groups'
import GroupDetail from './pages/GroupDetail'
import AssignmentDetail from './pages/AssignmentDetail'
import ContestParticipants from './pages/ContestParticipants'
import ContestRegister from './pages/ContestRegister'
import AdminJudge from './pages/AdminJudge'
import AdminNotifications from './pages/AdminNotifications'
import Favorites from './pages/Favorites'
import Notifications from './pages/Notifications'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import ProblemAdmin from './pages/ProblemAdmin'
import ProblemDetail from './pages/ProblemDetail'
import ProblemForm from './pages/ProblemForm'
import ProblemList from './pages/ProblemList'
import Profile from './pages/Profile'
import Ranking from './pages/Ranking'
import Register from './pages/Register'
import Status from './pages/Status'
import SubmissionDetail from './pages/SubmissionDetail'
import SubmitFile from './pages/SubmitFile'
import TestcaseAdmin from './pages/TestcaseAdmin'

/** 常规布局：导航栏 + 内容容器。 */
function AppLayout() {
  const location = useLocation()
  const dynamicStandings = location.pathname.endsWith('/standings/dynamic')
  const immersiveContestProblem = /^\/contest\/\d+\/problem\/\d+\/?$/.test(location.pathname)
  const contestMatch = location.pathname.match(/^\/contest\/(\d+)(?:\/|$)/)
  const contestId = contestMatch ? Number(contestMatch[1]) : 0
  const shellClass = dynamicStandings
    ? 'dynamic-standings-page'
    : immersiveContestProblem
      ? 'contest-immersive-shell'
      : 'container'

  return (
    <>
      {!dynamicStandings && !immersiveContestProblem && <Navbar />}
      <main className={shellClass}>
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/problems" element={<ProblemList />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/favorites" element={<ProtectedRoute><Favorites /></ProtectedRoute>} />
            <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
            <Route path="/groups" element={<ProtectedRoute><Groups /></ProtectedRoute>} />
            <Route path="/groups/:id" element={<ProtectedRoute><GroupDetail /></ProtectedRoute>} />
            <Route path="/assignments/:id" element={<ProtectedRoute><AssignmentDetail /></ProtectedRoute>} />
            <Route path="/ranking" element={<Ranking />} />
            <Route path="/status" element={<ProtectedRoute><Status /></ProtectedRoute>} />
            <Route path="/contests" element={<ContestList />} />
            <Route path="/contest/new" element={<AdminRoute><ContestForm /></AdminRoute>} />
            <Route path="/contest/:id" element={<ContestDetail />} />
            <Route path="/contest/:id/register" element={<ProtectedRoute><ContestRegister /></ProtectedRoute>} />
            <Route path="/contest/:id/edit" element={<AdminRoute><ContestForm /></AdminRoute>} />
            <Route path="/contest/:id/messages" element={<AdminRoute><ContestMessagesPage /></AdminRoute>} />
            <Route path="/contest/:id/participants" element={<AdminRoute><ContestParticipants /></AdminRoute>} />
            <Route path="/contest/:id/problem/:pid" element={<ProtectedRoute><ContestProblemPage /></ProtectedRoute>} />
            <Route path="/contest/:id/problems" element={<AdminRoute><ContestForm /></AdminRoute>} />
            <Route path="/contest/:id/submissions" element={<ProtectedRoute><ContestMySubmissions /></ProtectedRoute>} />
            <Route path="/contest/:id/standings" element={<ContestStandingsPage />} />
            <Route path="/contest/:id/standings/dynamic" element={<ContestStandingsPage />} />
            <Route path="/admin/problems" element={<AdminRoute><ProblemAdmin /></AdminRoute>} />
            <Route path="/admin/users" element={<AdminRoute><AdminUsers /></AdminRoute>} />
            <Route path="/admin/judge" element={<AdminRoute><AdminJudge /></AdminRoute>} />
            <Route path="/admin/notifications" element={<AdminRoute><AdminNotifications /></AdminRoute>} />
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
      {contestId > 0 && <ContestBroadcastGuard contestId={contestId} />}
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
