"""双层 Reviewer —— Layer 1: 静态规则检查（零 token 成本）。"""

import ast
import logging
import re
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class StaticReviewResult:
    passed: bool = True
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "passed": self.passed,
            "errors": self.errors,
            "warnings": self.warnings,
            "layer": "static",
        }


def review_static(output: str, language: str = "auto") -> StaticReviewResult:
    """第一层：静态规则检查。返回 StaticReviewResult，passed=True 才能进入 LLM 审查。"""
    result = StaticReviewResult()

    # 0. 空输出检测
    if not output or len(output.strip()) < 20:
        result.passed = False
        result.errors.append("输出过短（<20 字符），可能是空响应或生成失败")
        return result

    # 1. 提取代码块
    code_blocks = _extract_code_blocks(output)
    if not code_blocks:
        # 无代码块的纯文本输出，跳过语法检查
        _check_text_quality(output, result)
        return result

    for cb in code_blocks:
        lang = cb["language"] or language
        code = cb["code"]

        # 2. 代码长度检查
        if len(code) < 10:
            result.warnings.append(f"代码块过短（{len(code)} 字符），可能不完整")
        if len(code) > 50000:
            result.warnings.append(f"代码块过长（{len(code)} 字符），考虑拆分")

        # 3. 语言特定语法检查
        if lang in ("python", "py"):
            _check_python(code, result)
        elif lang in ("javascript", "js", "typescript", "ts"):
            _check_javascript(code, lang, result)
        elif lang in ("html",):
            _check_html(code, result)
        elif lang in ("css",):
            _check_css(code, result)
        elif lang in ("json",):
            _check_json(code, result)
        elif lang in ("sql",):
            _check_sql(code, result)

        # 4. 安全检查（所有语言）
        _check_security(code, lang, result)

    return result


def _extract_code_blocks(text: str) -> list[dict]:
    """从 markdown 文本中提取代码块。"""
    matches = re.finditer(r'```(\w*)\s*\n(.*?)```', text, re.DOTALL)
    blocks = []
    for m in matches:
        blocks.append({"language": m.group(1) or "text", "code": m.group(2).strip()})
    return blocks


def _check_text_quality(text: str, result: StaticReviewResult) -> None:
    """检查纯文本输出的质量。"""
    # 检测明显的幻觉标记
    hallucinations = [
        "as an AI", "I cannot", "I'm unable", "I apologize",
        "作为 AI", "我无法", "抱歉", "对不起，我",
    ]
    for h in hallucinations:
        if h.lower() in text.lower():
            result.warnings.append(f"输出可能包含拒绝/幻觉标记：\"{h}\"")
            break


def _check_python(code: str, result: StaticReviewResult) -> None:
    try:
        ast.parse(code)
    except SyntaxError as e:
        result.passed = False
        result.errors.append(f"Python 语法错误: {e.msg} (line {e.lineno})")

    # 检查常见缺失 import
    imports = set(re.findall(r'^import\s+(\w+)', code, re.MULTILINE))
    imports.update(re.findall(r'^from\s+(\w+)', code, re.MULTILINE))
    used_names = set(re.findall(r'\b(json|os|sys|re|datetime|math|random|collections|typing|pathlib|subprocess)\b', code))
    missing = used_names - imports
    if missing:
        result.warnings.append(f"可能缺少 import：{', '.join(sorted(missing))}")


def _check_javascript(code: str, language: str, result: StaticReviewResult) -> None:
    # 括号匹配
    stack = []
    pairs = {"{": "}", "(": ")", "[": "]"}
    for i, ch in enumerate(code):
        if ch in "{([":
            stack.append((ch, i))
        elif ch in "})]":
            if not stack:
                result.passed = False
                result.errors.append(f"JS/TS 括号不匹配：意外的 '{ch}' 在位置 {i}")
                return
            opener, pos = stack.pop()
            if pairs[opener] != ch:
                result.passed = False
                result.errors.append(f"JS/TS 括号不匹配：'{opener}' at {pos} 被 '{ch}' at {i} 关闭")
                return
    if stack:
        for opener, pos in stack:
            result.passed = False
            result.errors.append(f"JS/TS 未闭合的 '{opener}' 在位置 {pos}")

    # TS 特定检查
    if language in ("typescript", "ts"):
        if ": any" in code:
            result.warnings.append("TypeScript 使用了 'any' 类型，建议明确类型")


def _check_html(code: str, result: StaticReviewResult) -> None:
    # 检查基本 HTML 结构
    if "<html" in code.lower() and "</html>" not in code.lower():
        result.warnings.append("HTML: 有 <html> 开始标签但缺少 </html> 闭合")
    if "<body" in code.lower() and "</body>" not in code.lower():
        result.warnings.append("HTML: 有 <body> 开始标签但缺少 </body> 闭合")


def _check_css(code: str, result: StaticReviewResult) -> None:
    # 括号匹配
    opens = code.count("{")
    closes = code.count("}")
    if opens != closes:
        result.passed = False
        result.errors.append(f"CSS 括号不匹配：{opens} 个 '{{' vs {closes} 个 '}}'")


def _check_json(code: str, result: StaticReviewResult) -> None:
    import json
    try:
        json.loads(code)
    except json.JSONDecodeError as e:
        result.passed = False
        result.errors.append(f"JSON 解析错误：{e.msg} (line {e.lineno})")


def _check_sql(code: str, result: StaticReviewResult) -> None:
    dangerous = re.findall(r'\b(DROP|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE)\b', code, re.IGNORECASE)
    if dangerous:
        result.warnings.append(f"SQL 包含危险操作：{', '.join(dangerous)}")


def _check_security(code: str, language: str, result: StaticReviewResult) -> None:
    """通用安全检查。"""
    # 硬编码密钥
    if re.search(r'(password|secret|api_key|token)\s*=\s*["\'][^"\']+["\']', code, re.IGNORECASE):
        result.warnings.append("代码中可能包含硬编码的敏感信息（password/secret/api_key/token）")

    # eval / exec（Python / JS）
    if language in ("python", "py") and re.search(r'\beval\s*\(|\bexec\s*\(', code):
        result.warnings.append("使用了 eval/exec，可能存在安全风险")
    if language in ("javascript", "js", "typescript", "ts") and re.search(r'\beval\s*\(', code):
        result.warnings.append("使用了 eval()，可能存在安全风险")

    # 命令注入风险
    if language in ("python", "py") and re.search(r'\bos\.system\s*\(|\bsubprocess\.call\s*\(.*shell\s*=\s*True', code):
        result.warnings.append("使用了 os.system 或 subprocess shell=True，存在命令注入风险")
