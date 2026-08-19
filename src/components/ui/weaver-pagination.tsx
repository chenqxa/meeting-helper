import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

interface WeaverPaginationProps {
  total: number
  current: number
  pageSize: number
  pageSizeOptions?: number[]
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  className?: string
}

export function WeaverPagination({
  total,
  current,
  pageSize,
  pageSizeOptions = [10, 20, 50, 100],
  onPageChange,
  onPageSizeChange,
  className = ""
}: WeaverPaginationProps) {
  const totalPages = Math.ceil(total / pageSize)
  const [jumpInput, setJumpInput] = React.useState(String(current))
  const [jumpPage, setJumpPage] = React.useState<number | null>(null)

  // 计算显示的页码范围（最多显示7个页码）
  const getVisiblePages = () => {
    const pages: number[] = []
    const maxVisible = 7

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      const half = Math.floor(maxVisible / 2)
      let start = Math.max(1, current - half)
      let end = Math.min(totalPages, start + maxVisible - 1)

      if (end - start < maxVisible - 1) {
        start = Math.max(1, end - maxVisible + 1)
      }

      for (let i = start; i <= end; i++) {
        pages.push(i)
      }
    }

    return pages
  }

  const visiblePages = getVisiblePages()

  const handleJump = () => {
    const page = parseInt(jumpInput, 10)
    if (page >= 1 && page <= totalPages) {
      setJumpPage(page)
      onPageChange(page)
    }
    setJumpInput(String(current))
  }

  const handleJumpKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleJump()
    }
  }

  return (
    <div className={`flex items-center justify-between gap-6 text-sm ${className}`}>
      {/* 左侧：总条数 */}
      <div className="flex items-center gap-2">
        <span className="text-slate-500">共 <span className="font-medium text-slate-700">{total}</span> 条</span>
      </div>

      {/* 右侧：分页控制 */}
      <div className="flex items-center gap-3">
        {/* 每页条数 */}
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-slate-500 text-xs">每页</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-8 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white hover:border-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <span className="text-slate-500 text-xs">条</span>
          </div>
        )}

        {/* 分隔线 */}
        <div className="h-5 w-px bg-slate-200" />

        {/* 上一页 */}
        <button
          onClick={() => onPageChange(current - 1)}
          disabled={current === 1}
          className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-slate-600" />
        </button>

        {/* 页码 */}
        <div className="flex gap-1">
          {visiblePages.map((page) => (
            <button
              key={page}
              onClick={() => onPageChange(page)}
              className={`min-w-[32px] h-8 px-2.5 rounded-lg text-xs font-medium transition-colors ${
                page === current
                  ? "bg-blue-500 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {page}
            </button>
          ))}
        </div>

        {/* 下一页 */}
        <button
          onClick={() => onPageChange(current + 1)}
          disabled={current === totalPages}
          className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-slate-600" />
        </button>

        {/* 跳转 */}
        <div className="flex items-center gap-2 pl-2">
          <span className="text-slate-500 text-xs">跳至</span>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={jumpInput}
            onChange={(e) => setJumpInput(e.target.value)}
            onKeyDown={handleJumpKeyDown}
            className="w-14 h-8 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-center bg-white hover:border-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={handleJump}
            className="h-8 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-colors"
          >
            GO
          </button>
        </div>
      </div>
    </div>
  )
}
