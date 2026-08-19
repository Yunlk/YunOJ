interface PaginationProps {
  page: number
  total: number
  size: number
  onChange: (page: number) => void
}

type PageItem = number | '...'

function getPageItems(current: number, totalPages: number): PageItem[] {
  if (totalPages <= 1) return []
  const items: PageItem[] = []
  const start = Math.max(1, current - 2)
  const end = Math.min(totalPages, current + 2)

  if (start > 1) items.push(1)
  if (start > 2) items.push('...')
  for (let i = start; i <= end; i++) items.push(i)
  if (end < totalPages - 1) items.push('...')
  if (end < totalPages) items.push(totalPages)
  return items
}

export default function Pagination({ page, total, size, onChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / size))
  if (totalPages <= 1) return null
  const items = getPageItems(page, totalPages)

  return (
    <div className="pagination">
      <button
        type="button"
        className="page-button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        上一页
      </button>
      {items.map((item, idx) =>
        item === '...' ? (
          <span key={`ellipsis-${idx}`} className="page-ellipsis">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            className={`page-button ${item === page ? 'active' : ''}`}
            onClick={() => onChange(item)}
          >
            {item}
          </button>
        ),
      )}
      <button
        type="button"
        className="page-button"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        下一页
      </button>
    </div>
  )
}
