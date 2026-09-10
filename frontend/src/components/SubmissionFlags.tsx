// SubmissionFlags 展示提交的判定阶段标记（与后端 submission 字段语义一致）：
//   pretest_only  —— 比赛进行中只跑了预测试点，赛后会用完整数据重判（分数为临时分）
//   system_tested —— 赛后已用完整测试数据完成系统测试（分数为最终分）
//   is_hacked     —— 已被他人 Hack 成功，该判定与分数作废，不可恢复
export default function SubmissionFlags({
  pretestOnly,
  systemTested,
  isHacked,
}: {
  pretestOnly?: boolean
  systemTested?: boolean
  isHacked?: boolean
}) {
  if (!pretestOnly && !systemTested && !isHacked) return null
  return (
    <>
      {pretestOnly && !isHacked && (
        <span className="status-flag status-flag-pretest" title="比赛进行中只跑了预测试数据，赛后将以完整数据重判">
          预测试
        </span>
      )}
      {systemTested && !isHacked && (
        <span className="status-flag status-flag-system" title="赛后已用完整测试数据完成系统测试">
          已系统测试
        </span>
      )}
      {isHacked && (
        <span className="status-flag status-flag-hacked" title="已被他人 Hack 成功：该判定与分数作废">
          被 Hack
        </span>
      )}
    </>
  )
}
