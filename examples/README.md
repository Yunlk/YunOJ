# 特殊评测与交互题协议

## SPJ（special judge）

- 题目设置：`type = "spj"`，`spj_source` 填写 SPJ 源码（C++，在沙箱内以
  `g++ -O2 -std=c++17 -static` 编译）。
- 运行方式：每个测试点运行一次 `./spj <输入文件> <用户输出文件> <答案文件>`
  （三个参数为沙箱内路径），stdin 为空。
- 判定协议（退出码）：
  - `0` = AC
  - `1` = WA
  - `2` = PE（按 WA 处理）
  - 其他 = SE
- 部分分（可选）：stdout 第一行输出 `0~100` 的浮点分数，
  该测试点得分 = 分数 × 该点满分 / 100；不输出则 AC 得满分。
- 示例实现见 `examples/spj/`：
  - `float_checker.cpp`：浮点误差容忍比较器（绝对误差 < 1e-6）
  - `multi_answer_checker.cpp`：多解比较器（用户输出为答案集合中任意一个即可）

## 交互题（interactive）

- 题目设置：`type = "interactive"`，`interactor_source` 填写交互器源码（C++）。
- 运行方式：选手程序与交互器在同一个沙箱内通过两个 FIFO 双向通信：
  - 交互器 stdout → 选手 stdin
  - 选手 stdout → 交互器 stdin
- 交互器约定：
  - `argv[1]` 为测试输入文件（场景数据），由交互器自行读取解析
  - 从 stdin 读选手输出，向 stdout 写发给选手的数据
  - **每次写 stdout 后必须 `fflush(stdout)`**（否则选手读不到，最终超时）
  - 选手输出格式错误或提前退出（读到 EOF）时，交互器应返回非 0 退出码
- 判定协议（交互器退出码）：
  - `0` = AC
  - `1` = WA
  - `2` = SE
  - 超时（wall time）→ TLE；交互器崩溃 → SE
- 选手侧要求（写入题面说明）：每次输出后必须 flush（C++ 用 `endl` 或
  `fflush(stdout)`，Python 用 `flush=True`）。
- 示例实现见 `examples/interactive/guessing_game.cpp`（猜数字游戏，最多 60 次）。
