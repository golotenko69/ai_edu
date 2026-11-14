"""Детерминированный анализ кода: запрещённые конструкции и извлечение кода из ответа.

Правила вида «агент не пишет циклы» проверяются разбором кода (AST), а не
моделью: так надёжнее, дешевле и не обходится уговорами.
"""
import ast
import re

# Каталог конструкций, которые преподаватель может запретить
CONSTRUCTS = {
    "for": "цикл for",
    "while": "цикл while",
    "recursion": "рекурсия",
    "comprehension": "генераторы списков/словарей",
    "lambda": "lambda-функции",
    "import": "импорт модулей",
    "def": "объявление функций",
    "class": "объявление классов",
    "try": "обработка исключений try",
    "slicing": "срезы [a:b]",
}


def construct_title(key):
    if key.startswith("call:"):
        return f"функция {key[5:]}()"
    return CONSTRUCTS.get(key, key)


def find_python(code, forbidden):
    """Вернуть список нарушений [{construct, line, title}] для Python-кода.
    Если код не разбирается, пробуем убрать отступы/обрезки, иначе — регулярки."""
    if not forbidden:
        return []
    try:
        tree = ast.parse(code)
    except SyntaxError:
        try:
            import textwrap
            tree = ast.parse(textwrap.dedent(code))
        except SyntaxError:
            return find_regex(code, forbidden, "python")
    found = []
    forb = set(forbidden)
    calls = {f[5:] for f in forb if f.startswith("call:")}

    def add(key, node):
        found.append({"construct": key, "line": getattr(node, "lineno", 0), "title": construct_title(key)})

    for node in ast.walk(tree):
        if "for" in forb and isinstance(node, (ast.For, ast.AsyncFor)):
            add("for", node)
        if "while" in forb and isinstance(node, ast.While):
            add("while", node)
        if "comprehension" in forb and isinstance(node, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            add("comprehension", node)
        if "for" in forb and isinstance(node, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)) \
                and "comprehension" not in forb:
            add("for", node)
        if "lambda" in forb and isinstance(node, ast.Lambda):
            add("lambda", node)
        if "import" in forb and isinstance(node, (ast.Import, ast.ImportFrom)):
            add("import", node)
        if "def" in forb and isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            add("def", node)
        if "class" in forb and isinstance(node, ast.ClassDef):
            add("class", node)
        if "try" in forb and isinstance(node, ast.Try):
            add("try", node)
        if "slicing" in forb and isinstance(node, ast.Slice):
            add("slicing", node)
        if calls and isinstance(node, ast.Call):
            name = None
            if isinstance(node.func, ast.Name):
                name = node.func.id
            elif isinstance(node.func, ast.Attribute):
                name = node.func.attr
            if name in calls:
                add("call:" + name, node)
        if "recursion" in forb and isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for sub in ast.walk(node):
                if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Name) and sub.func.id == node.name:
                    add("recursion", sub)
                    break
    # убрать дубли
    uniq, seen = [], set()
    for f in found:
        k = (f["construct"], f["line"])
        if k not in seen:
            seen.add(k)
            uniq.append(f)
    return uniq


def find_regex(code, forbidden, language):
    """Упрощённая проверка для C++ и для неразбираемого Python."""
    found = []
    clean = re.sub(r"//[^\n]*|/\*.*?\*/|#[^\n]*" if language == "cpp" else r"#[^\n]*", "", code, flags=re.S)
    if language == "cpp":
        clean = re.sub(r'"(?:\\.|[^"\\])*"', '""', clean)
    lines = clean.split("\n")
    pats = {
        "for": r"\bfor\s*\(" if language == "cpp" else r"\bfor\b",
        "while": r"\bwhile\b",
        "lambda": r"\[[^\]]*\]\s*\(" if language == "cpp" else r"\blambda\b",
        "import": r"#\s*include" if language == "cpp" else r"^\s*(import|from)\b",
        "class": r"\b(class|struct)\b",
        "try": r"\btry\b",
        "comprehension": r"\[[^\]]*\bfor\b[^\]]*\]",
        "def": r"^\s*def\b",
    }
    src_lines = code.split("\n") if language == "cpp" else lines
    for key in forbidden:
        if key.startswith("call:"):
            pat = r"\b" + re.escape(key[5:]) + r"\s*\("
        else:
            pat = pats.get(key)
        if not pat:
            continue
        target = src_lines if key == "import" else lines
        for i, ln in enumerate(target, 1):
            if re.search(pat, ln):
                found.append({"construct": key, "line": i, "title": construct_title(key)})
                break
    if "recursion" in forbidden and language == "cpp":
        for m in re.finditer(r"\b(\w+)\s*\([^;{)]*\)\s*\{", clean):
            name = m.group(1)
            if name in ("if", "for", "while", "switch", "main"):
                continue
            body_start = m.end()
            depth, i = 1, body_start
            while i < len(clean) and depth:
                depth += {"{": 1, "}": -1}.get(clean[i], 0)
                i += 1
            if re.search(r"\b" + re.escape(name) + r"\s*\(", clean[body_start:i]):
                found.append({"construct": "recursion", "line": clean[:m.start()].count("\n") + 1,
                              "title": construct_title("recursion")})
                break
    return found


def find_forbidden(code, forbidden, language):
    if not forbidden or not code.strip():
        return []
    if language == "python":
        return find_python(code, forbidden)
    return find_regex(code, forbidden, language)


CODE_BLOCK_RE = re.compile(r"```[ \t]*([\w+#-]*)[ \t]*\n(.*?)```", re.S)


def extract_code_blocks(text):
    return [{"lang": m.group(1).lower(), "code": m.group(2).rstrip("\n")} for m in CODE_BLOCK_RE.finditer(text)]


def strip_code_blocks(text, replacement="[фрагмент кода скрыт правилами задания]"):
    return CODE_BLOCK_RE.sub(replacement, text)


def code_lines(code):
    return len([ln for ln in code.split("\n") if ln.strip()])


def inline_code_lines(text):
    """Код, записанный без ``` (модели иногда так делают): строки, похожие на код."""
    pat = re.compile(r"^\s*(def |for |while |if |elif |else:|return |print\(|import |from |class |\w+\s*=\s*.+|#include|int main|std::|cout|cin)")
    outside = CODE_BLOCK_RE.sub("", text)
    return [ln for ln in outside.split("\n") if pat.match(ln)]
