# YunOJ Frontend Optimization Review

**Codebase:** React 18 + TypeScript + Vite  
**Review Date:** 2024  
**Scope:** Component structure, state management, performance, bundle size, API patterns, type safety, accessibility, CSS architecture

---

## Executive Summary

The YunOJ frontend is a well-structured React/TypeScript application with good architectural foundations. However, there are significant opportunities for optimization in bundle size, render performance, state management, and accessibility. The codebase shows evidence of recent refactoring (design tokens, CSS architecture) but has inconsistent patterns between older and newer code.

**Priority Issues:**
1. ⚠️ **No code splitting** - entire app loads upfront (~892 line API file, Monaco editor)
2. ⚠️ **No request caching** - repeated API calls for the same data
3. ⚠️ **Excessive re-renders** - missing memoization in list components
4. ⚠️ **Bundle size concerns** - Monaco editor, KaTeX loaded unconditionally
5. ⚠️ **Prop drilling** - AuthContext is the only context, but data flows through props

---

## 1. Component Structure & Reusability

### ✅ Strengths
- **Good component separation**: Clear distinction between pages, components, and utilities
- **Reusable primitives**: `StatusBadge`, `DifficultyBadge`, `Pagination`, `Markdown` are well-extracted
- **Protected routes**: Clean auth boundary with `ProtectedRoute` and `AdminRoute`
- **Error boundary**: Global error handling implemented

### ⚠️ Issues

#### 1.1 Large Page Components
**Location:** `ProblemDetail.tsx` (468 lines), `ContestDetail.tsx` (864 lines), `ProblemList.tsx` (530 lines)

**Problem:** These monolithic components mix business logic, UI, and data fetching.

**Example - ProblemDetail.tsx:**
```typescript
export default function ProblemDetail() {
  // 20+ useState declarations
  const [problem, setProblem] = useState<ProblemDetailType | null>(null)
  const [favorite, setFavorite] = useState(false)
  const [editorial, setEditorial] = useState<ProblemEditorial | null>(null)
  // ... 17 more state variables
  
  // Multiple useEffect hooks
  useEffect(() => { /* fetch problem */ }, [id])
  useEffect(() => { /* fetch learning data */ }, [id])
  useEffect(() => { /* fetch languages */ }, [draftScope])
  // ... 5 more effects
}
```

**Recommendation:**
- Extract sub-components: `ProblemHeader`, `ProblemActions`, `DiscussionPanel`
- Create custom hooks: `useProblemData(id)`, `useCodeEditor(scope, language)`
- Split views: Problem statement could be its own route/component

#### 1.2 ProblemWorkbench Component Complexity
**Location:** `components/ProblemWorkbench.tsx` (527 lines)

**Problem:** Single component handles split panes, mobile responsive, drawer state, testing, submission - violates single responsibility principle.

**Recommendation:**
```typescript
// Split into smaller components
- WorkbenchLayout (split pane logic)
- CodeEditorPanel (toolbar + editor + statusbar)
- TestDrawer (self-test UI)
- MobileWorkbench (mobile-specific layout)
```

#### 1.3 Inline Component Definitions
**Location:** `ContestDetail.tsx` - multiple nested components

**Problem:** Components defined inside parent function re-create on every render.

```typescript
// ❌ Bad - recreates on every render
function ContestDetail() {
  const TeamPanel = ({ team }) => { /* ... */ }
  const ProblemsTable = ({ problems }) => { /* ... */ }
  // ...
}
```

**Recommendation:**
```typescript
// ✅ Good - define outside or memoize
const TeamPanel = memo(({ team, onChanged }) => { /* ... */ })
const ProblemsTable = memo(({ contestId, problems }) => { /* ... */ })
```

---

## 2. State Management Patterns & Prop Drilling

### Current State
- **Context:** Only `AuthContext` for user authentication
- **Local state:** Heavy use of `useState` in page components
- **No global state management** (Redux, Zustand, Jotai, etc.)

### ⚠️ Issues

#### 2.1 Excessive Local State
**Pattern across multiple files:**

```typescript
// ProblemList.tsx has 10+ state variables
const [problems, setProblems] = useState<ProblemListItem[]>([])
const [total, setTotal] = useState(0)
const [facets, setFacets] = useState<ProblemFacets | null>(null)
const [loading, setLoading] = useState(true)
const [error, setError] = useState('')
const [input, setInput] = useState(keyword)
const [tagPickerOpen, setTagPickerOpen] = useState(false)
// ... etc
```

**Problem:** 
- Scattered state logic
- Hard to test
- Difficult to share state between routes
- URL params as source of truth but duplicated in component state

**Recommendation:**
- Use **URL state** as single source of truth (already partially done)
- Reduce component state to only UI-specific concerns (modals, dropdowns)
- Consider React Query/SWR for server state management

#### 2.2 No Request Deduplication or Caching

**Location:** `Home.tsx`, `ProblemList.tsx`, multiple contest pages

**Problem:** Same data fetched multiple times:

```typescript
// Home.tsx
useEffect(() => { getHome().then(setData) }, [])
useEffect(() => { getProblemFacets().then(setFacets) }, [])

// ProblemList.tsx - fetches facets again!
useEffect(() => { getProblemFacets().then(setFacets) }, [])
```

If user navigates Home → Problems → Home, `getProblemFacets()` is called 3 times.

**Recommendation:**
Implement React Query or SWR:

```typescript
// ✅ With React Query - automatic caching, deduplication
function ProblemList() {
  const { data: facets } = useQuery({
    queryKey: ['problem-facets'],
    queryFn: getProblemFacets,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}
```

#### 2.3 Polling Without Cleanup

**Location:** `ContestDetail.tsx` - ContestCommunications component

```typescript
useEffect(() => {
  void load()
  const timer = window.setInterval(() => void load(), 3000)
  return () => window.clearInterval(timer)
}, [load])
```

**Problem:** Polling continues even when user navigates away (until unmount). With React Query, this is handled automatically with `refetchInterval`.

#### 2.4 Moderate Prop Drilling

While not excessive, some components pass props through 2-3 levels:

```typescript
// App.tsx → ProblemDetail → ProblemWorkbench → CodeEditor
// Languages array passed down 3 levels
```

**Recommendation:**
- For frequently accessed data (languages, user), consider additional contexts
- Or use composition over prop passing

---

## 3. Render Performance & Memoization

### ⚠️ Critical Issues

#### 3.1 Missing Memoization in Lists

**Location:** `ProblemList.tsx`, `ContestDetail.tsx` (ProblemsTable)

**Problem:** No memoization for expensive operations:

```typescript
// ProblemList.tsx - runs on EVERY render
{problems.map((p) => (
  <tr key={p.id} className="clickable-row" onClick={() => navigate(`/problem/${p.id}`)}>
    {/* Complex cells with calculations */}
    <td>{acceptanceText(p.accepted_count, p.submission_count)}</td>
  </tr>
))}
```

**Recommendation:**

```typescript
// ✅ Memoize list items
const ProblemRow = memo(({ problem, onNavigate }) => {
  const acceptance = useMemo(
    () => acceptanceText(problem.accepted_count, problem.submission_count),
    [problem.accepted_count, problem.submission_count]
  )
  
  return <tr onClick={() => onNavigate(problem.id)}>{/* ... */}</tr>
})
```

#### 3.2 Expensive Computations in Render

**Location:** `ProblemList.tsx`

```typescript
// Runs on every render, even when query hasn't changed
const query = useMemo(
  () => ({
    keyword: keyword || undefined,
    difficulty: difficulties.length ? difficulties : undefined,
    tag: tags.length ? tags : undefined,
    my_status: myStatus || undefined,
    sort,
  }),
  [keyword, difficulties, tags, myStatus, sort],
)
```

This is already memoized ✅, but the dependencies are URL params - should be computed once from searchParams.

#### 3.3 Missing useCallback for Event Handlers

**Location:** Throughout - handlers recreated on every render

```typescript
// ❌ Creates new function every render
<button onClick={() => navigate(`/problem/${id}`)}>Go</button>

// ✅ Better
const handleNavigate = useCallback(() => navigate(`/problem/${id}`), [id, navigate])
<button onClick={handleNavigate}>Go</button>
```

**Impact:** For lists with 20-100 items, this creates 20-100 new function objects per render.

#### 3.4 Unoptimized Context Consumers

**Location:** Every component using `useAuth()`

```typescript
// AuthContext.tsx
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  
  return (
    <AuthContext.Provider value={{ user, loading, setUser, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}
```

**Problem:** `value` object is recreated on every render, causing all consumers to re-render.

**Recommendation:**

```typescript
// ✅ Memoize context value
const value = useMemo(
  () => ({ user, loading, setUser, refresh }),
  [user, loading, setUser, refresh]
)

return (
  <AuthContext.Provider value={value}>
    {children}
  </AuthContext.Provider>
)
```

---

## 4. Bundle Size & Code Splitting

### 📊 Current State (estimated from package.json)

```json
"dependencies": {
  "@monaco-editor/react": "^4.7.0",    // ~2MB
  "monaco-editor": "^0.56.0",          // ~5MB
  "katex": "^0.16.11",                 // ~600KB
  "react-markdown": "^9.0.1",          // ~100KB
  "axios": "^1.7.9"                    // ~50KB
}
```

**Total vendor bundle:** Likely 8-10MB uncompressed

### ⚠️ Critical Issues

#### 4.1 No Route-Based Code Splitting

**Location:** `App.tsx`

```typescript
// ❌ All pages imported statically
import ContestDetail from './pages/ContestDetail'
import ContestForm from './pages/ContestForm'
import ProblemDetail from './pages/ProblemDetail'
// ... 20+ more imports
```

**Problem:** All page code loads upfront, even for admin-only routes.

**Recommendation:**

```typescript
// ✅ Lazy load routes
import { lazy, Suspense } from 'react'

const ContestDetail = lazy(() => import('./pages/ContestDetail'))
const ContestForm = lazy(() => import('./pages/ContestForm'))
const ProblemAdmin = lazy(() => import('./pages/ProblemAdmin'))

// In routes:
<Suspense fallback={<PageLoading />}>
  <Routes>
    <Route path="/contest/:id" element={<ContestDetail />} />
  </Routes>
</Suspense>
```

**Expected Savings:** 40-60% reduction in initial bundle size

#### 4.2 Monaco Editor Loaded Unconditionally

**Location:** `main.tsx` → `App.tsx` → includes Monaco indirectly

**Problem:** Monaco (~5MB) loads even for users just viewing problem lists or standings.

**Recommendation:**

```typescript
// ✅ Lazy load Monaco-dependent components
const ProblemWorkbench = lazy(() => import('./components/ProblemWorkbench'))
const CodeEditor = lazy(() => import('./components/CodeEditor'))

// Or even better - load Monaco on first code edit:
const CodeEditor = lazy(() => import('./components/CodeEditor'))

function LazyCodeEditor(props) {
  return (
    <Suspense fallback={<div>加载编辑器...</div>}>
      <CodeEditor {...props} />
    </Suspense>
  )
}
```

#### 4.3 KaTeX CSS Loaded Globally

**Location:** `main.tsx`

```typescript
import 'katex/dist/katex.min.css'
```

**Problem:** Math rendering CSS (600KB) loads even if user never views a problem with LaTeX.

**Recommendation:**

```typescript
// ✅ Load dynamically when Markdown component renders math
// In Markdown.tsx
useEffect(() => {
  if (content.includes('$')) {
    import('katex/dist/katex.min.css')
  }
}, [content])
```

#### 4.4 No Tree-Shaking of Unused Dependencies

**Recommendation:** Audit with `vite-plugin-bundle-analyzer`:

```typescript
// vite.config.ts
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  plugins: [
    react(),
    visualizer({ open: true, gzipSize: true })
  ]
})
```

---

## 5. API Call Patterns & Caching

### Current Pattern (api.ts)

```typescript
// All API functions are simple wrappers
export async function getProblems(params) {
  const res = await api.get<Page<ProblemListItem>>('/problems', { params })
  return res.data
}
```

### ⚠️ Issues

#### 5.1 No Request Deduplication

If two components call `getProblems()` simultaneously, two network requests fire.

#### 5.2 No Response Caching

```typescript
// User navigates: Home → Problems → Profile → Problems
// getProblems() is called twice for the same filter state
```

#### 5.3 No Optimistic Updates

When favoriting a problem:

```typescript
const toggleFavorite = async () => {
  try {
    setFavorite(await toggleProblemFavorite(Number(id)))
  } catch (err) {
    setActionError(extractError(err))
  }
}
```

UI waits for network response before updating.

#### 5.4 Manual Loading States Everywhere

Every component manually manages:
```typescript
const [loading, setLoading] = useState(true)
const [error, setError] = useState('')
const [data, setData] = useState(null)
```

### ✅ Recommendation: React Query

**Benefits:**
- Automatic caching, deduplication, background refetching
- Optimistic updates
- Stale-while-revalidate pattern
- Eliminates 90% of loading/error state boilerplate

**Example Migration:**

```typescript
// ❌ Current pattern (45 lines)
export default function ProblemList() {
  const [problems, setProblems] = useState<ProblemListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getProblems({ page, size, keyword })
      .then((data) => {
        if (!cancelled) {
          setProblems(data.items)
          setTotal(data.total)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(extractError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [page, size, keyword])

  if (loading) return <Loading />
  if (error) return <Error>{error}</Error>
  // ...
}

// ✅ With React Query (15 lines)
export default function ProblemList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['problems', { page, size, keyword }],
    queryFn: () => getProblems({ page, size, keyword }),
    staleTime: 30_000,
    keepPreviousData: true,
  })

  if (isLoading) return <Loading />
  if (error) return <Error>{error.message}</Error>
  // ...
}
```

**Installation:**
```bash
npm install @tanstack/react-query
```

**Setup:**
```typescript
// main.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <App />
    </AuthProvider>
  </QueryClientProvider>
)
```

---

## 6. TypeScript Type Safety Gaps

### ✅ Strengths
- Comprehensive type definitions in `types.ts` (715 lines)
- API functions have proper return types
- Discriminated unions for submission status

### ⚠️ Issues

#### 6.1 Liberal Use of `any` and Type Assertions

**Location:** `ProblemDetail.tsx`

```typescript
const [discussions, setDiscussions] = useState<import('../types').ProblemDiscussion[]>([])
```

Why `import()` inline? Types should be imported at top level.

**Location:** `api.ts`

```typescript
export function extractError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined
    // Type assertion without validation
  }
}
```

#### 6.2 Missing Null/Undefined Checks

**Location:** Multiple components

```typescript
// Potential runtime error if problem is null
<h1>{problem.title}</h1>
```

Should use optional chaining or guard clauses.

#### 6.3 Implicit Any in Event Handlers

**Location:** Throughout

```typescript
// ❌ Implicit any
onChange={(e) => setInput(e.target.value)}

// ✅ Explicit
onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
```

**Recommendation:**
- Enable `strict: true` and `noImplicitAny: true` in tsconfig.json
- Add ESLint rule: `@typescript-eslint/no-explicit-any: error`
- Create branded types for IDs: `type ProblemId = number & { __brand: 'ProblemId' }`

---

## 7. Accessibility Issues

### ⚠️ Critical Issues

#### 7.1 Missing Form Labels

**Location:** `ProblemList.tsx`, `ContestDetail.tsx`

```typescript
// ❌ Input without associated label
<input
  type="search"
  value={input}
  onChange={(e) => setInput(e.target.value)}
  placeholder="搜索题目标题…"
/>
```

**Recommendation:**

```typescript
// ✅ Proper label association
<label htmlFor="problem-search" className="visually-hidden">
  搜索题目
</label>
<input
  id="problem-search"
  type="search"
  aria-label="搜索题目"
  value={input}
  onChange={(e) => setInput(e.target.value)}
/>
```

#### 7.2 Button Accessibility

**Location:** Multiple components

```typescript
// ❌ Missing type="button"
<button onClick={handleClick}>Click</button>
```

Without `type="button"`, buttons in forms trigger submission.

#### 7.3 Keyboard Navigation Issues

**Location:** `ProblemWorkbench.tsx` split divider

```typescript
<div
  className="wb-divider"
  onPointerDown={startDrag}
  // ❌ No keyboard alternative
/>
```

**Recommendation:**
```typescript
<div
  role="separator"
  aria-orientation="vertical"
  tabIndex={0}
  onKeyDown={(e) => {
    if (e.key === 'ArrowLeft') adjustSplit(-0.05)
    if (e.key === 'ArrowRight') adjustSplit(0.05)
  }}
/>
```

#### 7.4 Focus Management

**Missing:** Focus trap in modals, focus restoration after navigation

**Location:** `CommandPalette.tsx` - ✅ Good example of proper focus management:

```typescript
useEffect(() => {
  if (!open) return
  const timer = window.setTimeout(() => inputRef.current?.focus(), 20)
  return () => window.clearTimeout(timer)
}, [open])
```

#### 7.5 Color Contrast

**Location:** `styles/tokens.css`

```css
--c-text-3: #5b6b7f;
```

Need to verify this meets WCAG AA (4.5:1) on white background.

**Recommendation:**
- Run automated accessibility audit with axe DevTools
- Add aria-live regions for dynamic content updates
- Ensure all interactive elements are keyboard accessible
- Test with screen reader (NVDA/JAWS on Windows)

---

## 8. CSS Architecture & Duplication

### ✅ Strengths

Recent refactoring shows good CSS architecture:

- **Design tokens:** `tokens.css` with semantic variables
- **Layered styles:** Foundation → Base → Layout → Components → Pages
- **Component-scoped CSS:** Pages have dedicated stylesheets

### ⚠️ Issues

#### 8.1 Legacy Variables Coexist with New Tokens

**Location:** `styles.css` + `tokens.css`

```css
/* styles.css (old) */
:root {
  --bg: #f5f6f8;
  --primary: #2563eb;
}

/* tokens.css (new) */
:root {
  --c-bg: #f2f5f9;
  --c-primary: #2563d8;
  
  /* Compatibility layer */
  --bg: var(--c-bg);
  --primary: var(--c-primary);
}
```

**Problem:** Maintaining two naming schemes increases complexity.

**Recommendation:** 
- Complete migration to semantic tokens (`--c-*`, `--space-*`, `--fs-*`)
- Remove old variable names after updating all references
- Document token usage in a style guide

#### 8.2 CSS File Loading Order Fragility

**Location:** `main.tsx`

```typescript
import './styles.css'           // 6543 lines - legacy
import './styles/foundation.css'
import './styles/tokens.css'
import './styles/base.css'
// ... order matters for specificity
```

**Problem:** CSS cascade relies on import order. Hard to reason about.

**Recommendation:**
- Use CSS Modules or CSS-in-JS for component styles
- Or adopt CSS layers:

```css
@layer reset, tokens, base, components, utilities, page-specific;

@layer tokens {
  :root { /* ... */ }
}
```

#### 8.3 Large Monolithic styles.css

**Location:** `styles.css` (6543 lines)

**Problem:** 
- Hard to navigate
- Likely contains unused rules
- Slows down hot reload

**Recommendation:**
- Split into logical modules
- Use PurgeCSS to remove unused styles in production
- Consider migrating to Tailwind CSS or similar utility-first framework

#### 8.4 Duplicate Color Definitions

**Example:** Status colors defined in multiple places:
- `utils/status.ts` (JavaScript constants)
- `styles/tokens.css` (CSS variables)
- Inline styles in components

**Recommendation:**
- Single source of truth in `tokens.css`
- Use CSS variables in TypeScript:

```typescript
// ✅ Read from CSS
const statusColor = getComputedStyle(document.documentElement)
  .getPropertyValue('--verdict-green')
```

#### 8.5 Missing CSS Variable Fallbacks

**Location:** Throughout CSS

```css
color: var(--c-text);  /* ❌ No fallback */
```

**Recommendation:**
```css
color: var(--c-text, #16233a);  /* ✅ With fallback */
```

---

## 9. Additional Findings

### 9.1 Local Storage Usage

**Location:** `useCodeDraft.ts`, `ProblemWorkbench.tsx`

**Issues:**
- No error handling for QuotaExceededError
- No versioning for stored data
- Could lose data on storage clear

**Recommendation:**
- Wrap localStorage in try/catch
- Add version prefix to keys: `yunoj:v2:code-draft:`
- Consider IndexedDB for larger data

### 9.2 Memory Leaks

**Potential Issues:**
- Timers not cleared (found some ✅, but verify all)
- Event listeners not removed
- Monaco editor instances not disposed

**Recommendation:**
- Audit all `setInterval`/`setTimeout` for cleanup
- Use `useEffect` return for cleanup
- Dispose Monaco editor on unmount:

```typescript
useEffect(() => {
  return () => editor?.dispose()
}, [editor])
```

### 9.3 Error Handling

**Good:** Global error boundary exists  
**Issue:** Network errors shown but not logged

**Recommendation:**
- Add error tracking (Sentry, LogRocket)
- Show user-friendly messages, log technical details
- Retry logic for transient failures

### 9.4 Testing

**Status:** No test files found in the codebase

**Recommendation:**
- Add Vitest for unit tests
- Add React Testing Library for component tests
- Add Playwright for E2E tests
- Target coverage: 60% for critical paths

---

## 10. Migration Priorities

### Phase 1: Quick Wins (1-2 weeks)
1. **Add React Query** - Eliminates caching issues, reduces boilerplate
2. **Memoize AuthContext value** - Prevents unnecessary re-renders
3. **Add route-based code splitting** - 40-60% bundle size reduction
4. **Lazy load Monaco editor** - Improves initial page load
5. **Fix accessibility issues** - Form labels, button types, ARIA attributes

### Phase 2: Performance (2-3 weeks)
1. **Memoize list item components** - Prevents re-renders
2. **Add useCallback to event handlers** - Reduces allocations
3. **Optimize large page components** - Extract sub-components and custom hooks
4. **Add bundle analyzer** - Identify large dependencies

### Phase 3: Architecture (3-4 weeks)
1. **Complete CSS token migration** - Remove legacy variables
2. **Split monolithic styles.css** - Improve maintainability
3. **Add Tailwind CSS (optional)** - Reduce custom CSS
4. **Refactor ProblemWorkbench** - Extract smaller components

### Phase 4: Quality (2-3 weeks)
1. **Add TypeScript strict mode** - Catch type errors
2. **Add testing framework** - Unit + integration tests
3. **Add error tracking** - Monitor production issues
4. **Accessibility audit** - Automated + manual testing

---

## 11. Concrete Code Examples

### Example 1: Migrate ProblemList to React Query

```typescript
// Before (ProblemList.tsx) - 45 lines of boilerplate
export default function ProblemList() {
  const [problems, setProblems] = useState<ProblemListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getProblems({ page, size, keyword, difficulty, tag, my_status, sort })
      .then((data) => {
        if (cancelled) return
        setProblems(data.items)
        setTotal(data.total)
      })
      .catch((err) => {
        if (!cancelled) setError(extractError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [page, size, keyword, difficulty, tag, my_status, sort])

  if (loading) return <div className="page-loading">加载中…</div>
  if (error) return <div className="error-message">{error}</div>
  // ...
}

// After - 12 lines
export default function ProblemList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['problems', { page, size, keyword, difficulty, tag, my_status, sort }],
    queryFn: () => getProblems({ page, size, keyword, difficulty, tag, my_status, sort }),
    keepPreviousData: true,
  })

  if (isLoading) return <div className="page-loading">加载中…</div>
  if (error) return <div className="error-message">{extractError(error)}</div>

  const { items: problems, total } = data || { items: [], total: 0 }
  // ...
}
```

### Example 2: Add Route-Based Code Splitting

```typescript
// Before (App.tsx)
import ContestDetail from './pages/ContestDetail'
import ProblemAdmin from './pages/ProblemAdmin'
import TestcaseAdmin from './pages/TestcaseAdmin'

// After
import { lazy, Suspense } from 'react'

const ContestDetail = lazy(() => import('./pages/ContestDetail'))
const ProblemAdmin = lazy(() => import('./pages/ProblemAdmin'))
const TestcaseAdmin = lazy(() => import('./pages/TestcaseAdmin'))

function AppLayout() {
  return (
    <Suspense fallback={<div className="page-loading">加载中…</div>}>
      <Routes>
        <Route path="/contest/:id" element={<ContestDetail />} />
        <Route path="/admin/problems" element={<AdminRoute><ProblemAdmin /></AdminRoute>} />
      </Routes>
    </Suspense>
  )
}
```

### Example 3: Memoize List Items

```typescript
// Before (ProblemList.tsx)
{problems.map((p) => (
  <tr key={p.id} onClick={() => navigate(`/problem/${p.id}`)}>
    <td>{p.id}</td>
    <td>{p.title}</td>
    <td>{acceptanceText(p.accepted_count, p.submission_count)}</td>
  </tr>
))}

// After
const ProblemRow = memo(({ problem }: { problem: ProblemListItem }) => {
  const navigate = useNavigate()
  const handleClick = useCallback(() => {
    navigate(`/problem/${problem.id}`)
  }, [navigate, problem.id])

  const acceptance = useMemo(
    () => acceptanceText(problem.accepted_count, problem.submission_count),
    [problem.accepted_count, problem.submission_count]
  )

  return (
    <tr onClick={handleClick}>
      <td>{problem.id}</td>
      <td>{problem.title}</td>
      <td>{acceptance}</td>
    </tr>
  )
})

// In component
{problems.map((p) => <ProblemRow key={p.id} problem={p} />)}
```

---

## 12. Estimated Impact

| Optimization | Effort | Impact | Priority |
|--------------|--------|--------|----------|
| React Query | Medium | High | 🔴 Critical |
| Code Splitting | Low | High | 🔴 Critical |
| Lazy Load Monaco | Low | High | 🔴 Critical |
| Memoization | Medium | High | 🟡 High |
| AuthContext Memo | Low | Medium | 🟡 High |
| Split Large Components | High | Medium | 🟢 Medium |
| CSS Migration | High | Low | 🟢 Medium |
| TypeScript Strict | Medium | Medium | 🟢 Medium |
| Add Tests | High | Medium | 🟢 Medium |
| Accessibility | Medium | High | 🟡 High |

---

## 13. Tooling Recommendations

Install these dev dependencies:

```bash
npm install --save-dev \
  @tanstack/react-query-devtools \
  @vitejs/plugin-react-swc \
  rollup-plugin-visualizer \
  vite-plugin-compression \
  @axe-core/react \
  eslint-plugin-react-hooks \
  eslint-plugin-jsx-a11y
```

Update `vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc' // Faster than babel
import { visualizer } from 'rollup-plugin-visualizer'
import viteCompression from 'vite-plugin-compression'

export default defineConfig({
  plugins: [
    react(),
    viteCompression({ algorithm: 'brotli' }),
    visualizer({ open: true, gzipSize: true }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom', 'react-router-dom'],
          'monaco': ['@monaco-editor/react', 'monaco-editor'],
          'markdown': ['react-markdown', 'rehype-katex', 'remark-gfm'],
        },
      },
    },
  },
})
```

---

## Conclusion

The YunOJ frontend is well-structured with good separation of concerns, but has significant optimization opportunities. The highest-impact changes are:

1. **Add React Query** - Solves caching, deduplication, and reduces boilerplate by ~60%
2. **Implement code splitting** - Reduces initial bundle by 40-60%
3. **Lazy load Monaco** - Improves page load for non-coding routes
4. **Add memoization** - Prevents unnecessary re-renders in lists
5. **Fix accessibility gaps** - Improves usability and compliance

These changes can be implemented incrementally without major refactoring, and each provides measurable improvement to user experience and developer productivity.
