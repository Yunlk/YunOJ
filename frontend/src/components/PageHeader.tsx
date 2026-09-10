import type { ReactNode } from 'react'

type PageHeaderProps = {
  title: string
  description?: string
  eyebrow?: string
  actions?: ReactNode
  className?: string
}

/** Shared public-page header. Keep actions beside the page identity, not in a second toolbar. */
export default function PageHeader({ title, description, eyebrow, actions, className = '' }: PageHeaderProps) {
  return (
    <header className={`page-header page-header-standard ${className}`.trim()}>
      <div className="page-heading">
        {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}
