import { BrowserRouter, Route, Routes } from 'react-router-dom'
import AdminRoute from './components/AdminRoute'
import Navbar from './components/Navbar'
import ProtectedRoute from './components/ProtectedRoute'
import ContestDetail from './pages/ContestDetail'
import ContestForm from './pages/ContestForm'
import ContestList from './pages/ContestList'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import ProblemDetail from './pages/ProblemDetail'
import ProblemForm from './pages/ProblemForm'
import ProblemList from './pages/ProblemList'
import Register from './pages/Register'
import Status from './pages/Status'
import SubmissionDetail from './pages/SubmissionDetail'
import SubmitFile from './pages/SubmitFile'

export default function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <main className="container">
        <Routes>
          <Route path="/" element={<ProblemList />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/status" element={<Status />} />
          <Route path="/contests" element={<ContestList />} />
          <Route path="/contest/new" element={<AdminRoute><ContestForm /></AdminRoute>} />
          <Route path="/contest/:id" element={<ContestDetail />} />
          <Route path="/contest/:id/edit" element={<AdminRoute><ContestForm /></AdminRoute>} />
          <Route path="/problem/new" element={<AdminRoute><ProblemForm /></AdminRoute>} />
          <Route path="/problem/:id" element={<ProblemDetail />} />
          <Route path="/problem/:id/edit" element={<AdminRoute><ProblemForm /></AdminRoute>} />
          <Route path="/problem/:id/submit-file" element={<ProtectedRoute><SubmitFile /></ProtectedRoute>} />
          <Route path="/submission/:id" element={<ProtectedRoute><SubmissionDetail /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}
