import type { ProblemHarness } from '../types'

/** 驱动模板里选手代码的占位符（必须与后端 model.HarnessPlaceholder 一致）。 */
export const HARNESS_PLACEHOLDER = '{{code}}'

export const PLACEHOLDER_HINT = `驱动模板必须包含 ${HARNESS_PLACEHOLDER} 占位符，评测时选手代码会替换到这里。`

/**
 * 各语言的默认模板与初始代码骨架。
 *
 * 默认模板按「读入 → 调用选手函数 → 输出」的最简骨架生成，
 * 管理员按题目实际输入格式微调即可，不必从零写起。
 */
export function makeDefaultHarness(language: string): ProblemHarness {
  switch (language) {
    case 'cpp':
    case 'c':
      return {
        template: `#include <bits/stdc++.h>
using namespace std;

${HARNESS_PLACEHOLDER}

int main() {
    // TODO: 按题目输入格式读入
    return 0;
}`,
        initial_code: `// 只写这个函数即可，输入输出由题目模板负责
int solve(int a, int b) {
    // TODO: 在这里实现
    return 0;
}`,
      }
    case 'python':
      return {
        template: `import sys

${HARNESS_PLACEHOLDER}

def main():
    data = sys.stdin.read().split()
    # TODO: 按题目输入格式解析 data 并调用选手函数
    print(solve(0, 0))

main()`,
        initial_code: `def solve(a, b):
    # TODO: 在这里实现
    return 0`,
      }
    default:
      return {
        template: `${HARNESS_PLACEHOLDER}\n\n// TODO: 补充读入、调用与输出`,
        initial_code: '// TODO: 在这里实现题目要求的函数',
      }
  }
}

/** 校验语言模板集合，返回人类可读的问题列表（空数组表示没问题）。 */
export function harnessProblems(harnesses: Record<string, ProblemHarness>): string[] {
  const problems: string[] = []
  for (const [language, h] of Object.entries(harnesses)) {
    if (!h.template.trim()) {
      problems.push(`${language}：驱动模板不能为空`)
      continue
    }
    if (!h.template.includes(HARNESS_PLACEHOLDER)) {
      problems.push(`${language}：${PLACEHOLDER_HINT}`)
    }
  }
  return problems
}
