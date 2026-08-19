// 示例 SPJ：浮点数误差容忍比较器
// 协议：argv = [输入文件, 用户输出文件, 答案文件]，stdin 不使用。
// 退出码：0 = AC，1 = WA，2 = PE，其他 = SE。
// 判定规则：两侧输出逐 token 比较；数值 token 的绝对误差 < 1e-6 视为相等；
// 非数值 token 必须完全一致；token 数量不同判 WA。
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <vector>
#include <string>
#include <cstring>

static bool isNumber(const std::string& s) {
    char* end = nullptr;
    strtod(s.c_str(), &end);
    return end != s.c_str() && *end == '\0';
}

static bool readTokens(const char* path, std::vector<std::string>& out) {
    FILE* f = fopen(path, "r");
    if (!f) return false;
    char buf[4096];
    std::string cur;
    while (fgets(buf, sizeof(buf), f)) {
        for (char* p = buf; *p; p++) {
            if (*p == ' ' || *p == '\n' || *p == '\r' || *p == '\t') {
                if (!cur.empty()) { out.push_back(cur); cur.clear(); }
            } else {
                cur.push_back(*p);
            }
        }
    }
    if (!cur.empty()) out.push_back(cur);
    fclose(f);
    return true;
}

int main(int argc, char** argv) {
    if (argc != 4) return 3;
    std::vector<std::string> user, ans;
    if (!readTokens(argv[2], user) || !readTokens(argv[3], ans)) return 1;
    if (user.size() != ans.size()) return 1;
    for (size_t i = 0; i < user.size(); i++) {
        if (isNumber(user[i]) && isNumber(ans[i])) {
            double a = strtod(user[i].c_str(), nullptr);
            double b = strtod(ans[i].c_str(), nullptr);
            if (std::fabs(a - b) > 1e-6) return 1;
        } else if (user[i] != ans[i]) {
            return 1;
        }
    }
    return 0;
}
