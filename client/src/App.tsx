import { useEffect, useRef, type ComponentType } from 'react'
import { AppShell } from './components/AppShell'
import { DEFAULT_PATH, NAVIGATION, PRODUCT_NAME, SECTIONS } from './navigation'
import { DocumentAnalysisPage } from './pages/DocumentAnalysisPage'
import { LearningGeneratorPage } from './pages/LearningGeneratorPage'
import { NewProjectPage } from './pages/NewProjectPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ReviewPage } from './pages/ReviewPage'
import { UpdatesPage } from './pages/UpdatesPage'
import { navigate, usePathname } from './router'

const PAGES: Record<string, ComponentType> = {
  [SECTIONS.newProject.path]: NewProjectPage,
  [SECTIONS.analysis.path]: DocumentAnalysisPage,
  [SECTIONS.generator.path]: LearningGeneratorPage,
  [SECTIONS.review.path]: ReviewPage,
  [SECTIONS.updates.path]: UpdatesPage,
}

/** Normalizes a trailing slash so "/actualizaciones/" matches "/actualizaciones". */
const normalize = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path)

function App() {
  const pathname = normalize(usePathname())

  useEffect(() => {
    if (pathname === '/') navigate(DEFAULT_PATH, { replace: true })
  }, [pathname])

  useEffect(() => {
    const section = NAVIGATION.find((s) => s.path === pathname)
    document.title = section ? `${section.label} · ${PRODUCT_NAME}` : `Página no encontrada · ${PRODUCT_NAME}`
  }, [pathname])

  // On client-side navigation (not on first load), scroll to top and move focus to the new page title.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    window.scrollTo(0, 0)
    document.getElementById('page-title')?.focus({ preventScroll: true })
  }, [pathname])

  const Page = PAGES[pathname] ?? (pathname === '/' ? null : NotFoundPage)
  return <AppShell pathname={pathname}>{Page && <Page />}</AppShell>
}

export default App
