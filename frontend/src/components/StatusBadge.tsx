import { getStatusInfo } from '../utils/status'

export default function StatusBadge({ status }: { status: string }) {
  const info = getStatusInfo(status)
  return <span className={`status-badge status-${info.color}`}>{info.label}</span>
}
