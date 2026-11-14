"""Демо-данные: вуз-группа, преподаватель, студенты, курс и задания во всех режимах."""
import json
import time

from . import auth, db

MATERIALS = """Лекция 1. Ввод и вывод.
input() читает строку. Чтобы получить число: n = int(input()). Несколько чисел в строке:
a, b = map(int, input().split()). print(x, y) печатает значения через пробел.

Лекция 2. Условия и циклы.
if / elif / else. Цикл while выполняется, пока условие истинно. Цикл for перебирает элементы
последовательности: for i in range(n). Операции // (целочисленное деление) и % (остаток).

Лекция 3. Функции и рекурсия.
def имя(параметры): ... return значение. Рекурсивная функция вызывает саму себя; у неё обязательно
должен быть базовый случай, при котором рекурсия останавливается.

Лекция 4. Списки.
Список: a = [1, 2, 3]. len(a) — длина, a[i] — элемент, sum(a), min(a), max(a). round(x, 2) — округление.
"""

TASKS = [
    {
        "title": "Сумма цифр числа",
        "description": "Дано натуральное число n (1 ≤ n ≤ 10^18). Выведите сумму его цифр.\n\nПример:\nВвод: 1234\nВывод: 10",
        "language": "python", "mode": "hints",
        "starter_code": "n = int(input())\n\n# посчитайте сумму цифр числа n\n",
        "rules": {"hint_limit": 10, "understanding": "block",
                  "solution": "n = int(input())\ns = 0\nwhile n > 0:\n    s += n % 10\n    n //= 10\nprint(s)"},
        "tests": [{"input": "1234", "expected": "10"}, {"input": "7", "expected": "7"},
                  {"input": "1000000000000000000", "expected": "1", "hidden": True},
                  {"input": "999999999", "expected": "81", "hidden": True}],
    },
    {
        "title": "Факториал без циклов",
        "description": "Дано целое n (0 ≤ n ≤ 20). Выведите n! — произведение чисел от 1 до n (0! = 1).\n\n"
                       "Тема занятия — рекурсия, поэтому циклы for и while использовать нельзя.\n\nПример:\nВвод: 5\nВывод: 120",
        "language": "python", "mode": "fragments",
        "starter_code": "def factorial(n):\n    # напишите рекурсивную функцию\n    pass\n\n\nn = int(input())\nprint(factorial(n))\n",
        "rules": {"forbidden": ["for", "while", "import", "call:reduce", "call:prod"],
                  "max_fragment_lines": 4, "understanding": "block",
                  "solution": "def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n\n\nn = int(input())\nprint(factorial(n))"},
        "tests": [{"input": "5", "expected": "120"}, {"input": "0", "expected": "1"},
                  {"input": "20", "expected": "2432902008176640000", "hidden": True}],
    },
    {
        "title": "Статистика оценок",
        "description": "В одной строке через пробел даны оценки студентов (целые от 2 до 5). Выведите в одной строке "
                       "через пробел: минимальную оценку, максимальную и среднее, округлённое до 2 знаков.\n\n"
                       "Пример:\nВвод: 5 4 3 5\nВывод: 3 5 4.25",
        "language": "python", "mode": "fragments",
        "starter_code": "",
        "rules": {"max_fragment_lines": 6, "understanding": "block",
                  "solution": "a = list(map(int, input().split()))\nprint(min(a), max(a), round(sum(a) / len(a), 2))"},
        "tests": [{"input": "5 4 3 5", "expected": "3 5 4.25"}, {"input": "2", "expected": "2 2 2.0"},
                  {"input": "3 3 4", "expected": "3 4 3.33", "hidden": True}],
    },
    {
        "title": "Палиндром",
        "description": "Дана строка из строчных латинских букв. Выведите YES, если она читается одинаково слева "
                       "направо и справа налево, иначе NO.\n\nПример:\nВвод: level\nВывод: YES",
        "language": "python", "mode": "explain",
        "starter_code": "s = input()\n",
        "rules": {"understanding": "soft", "solution": "s = input()\nprint('YES' if s == s[::-1] else 'NO')"},
        "tests": [{"input": "level", "expected": "YES"}, {"input": "abc", "expected": "NO"},
                  {"input": "a", "expected": "YES", "hidden": True}],
    },
    {
        "title": "Максимум из трёх (C++)",
        "description": "Даны три целых числа a, b, c. Выведите наибольшее из них. Решите на C++ без std::max.\n\n"
                       "Пример:\nВвод: 3 9 4\nВывод: 9",
        "language": "cpp", "mode": "hints",
        "starter_code": "#include <iostream>\n\nint main() {\n    int a, b, c;\n    std::cin >> a >> b >> c;\n    \n    return 0;\n}\n",
        "rules": {"forbidden": ["call:max"], "understanding": "block",
                  "solution": "#include <iostream>\nint main(){int a,b,c;std::cin>>a>>b>>c;int m=a;if(b>m)m=b;if(c>m)m=c;std::cout<<m;}"},
        "tests": [{"input": "3 9 4", "expected": "9"}, {"input": "-1 -5 -2", "expected": "-1"},
                  {"input": "7 7 7", "expected": "7", "hidden": True}],
    },
    {
        "title": "Мини-проект: телефонная книга",
        "description": "Проектное задание для старших курсов. Программа получает команды, по одной в строке:\n"
                       "ADD имя телефон — добавить запись;\nGET имя — вывести телефон или NOT FOUND;\nEND — конец ввода.\n\n"
                       "Агент работает в свободном режиме: можно просить его писать код, но вы должны понимать каждую строку.",
        "language": "python", "mode": "free",
        "starter_code": "",
        "rules": {"understanding": "soft"},
        "tests": [{"input": "ADD ivan 123\nGET ivan\nGET petr\nEND", "expected": "123\nNOT FOUND"}],
    },
    {
        "title": "Контрольная: чётные числа",
        "description": "Дано n, затем n целых чисел через пробел. Выведите количество чётных чисел.\n\n"
                       "Пример:\nВвод:\n5\n1 2 3 4 6\nВывод: 3\n\nКонтрольная работа: агент молчит, работа идёт в режиме киоска.",
        "language": "python", "mode": "silent", "kind": "control",
        "starter_code": "",
        "rules": {"understanding": "off",
                  "solution": "n = int(input())\na = list(map(int, input().split()))\nprint(sum(1 for x in a if x % 2 == 0))"},
        "tests": [{"input": "5\n1 2 3 4 6", "expected": "3"}, {"input": "1\n7", "expected": "0"},
                  {"input": "3\n-2 0 2", "expected": "3", "hidden": True}],
    },
]


def seed_if_empty():
    if db.q1("SELECT id FROM users LIMIT 1"):
        return False
    gid = db.ex("INSERT INTO groups (name) VALUES (?)", ("ИВТ-21",))
    db.ex("INSERT INTO groups (name) VALUES (?)", ("ПИ-22",))
    auth.create_user("admin", "admin", "Администратор", "admin")
    tid = auth.create_user("teacher", "teacher", "Ирина Сергеевна Павлова", "teacher")
    for i, name in enumerate(["Алексей Смирнов", "Мария Кузнецова", "Дмитрий Попов", "Анна Волкова"], 1):
        auth.create_user(f"student{i}", "student", name, "student", gid)
    cid = db.ex("INSERT INTO courses (title, description, group_id, teacher_id, materials) VALUES (?,?,?,?,?)",
                ("Основы программирования на Python", "1 курс, весенний семестр", gid, tid, MATERIALS))
    now = time.time()
    for pos, t in enumerate(TASKS):
        db.ex("INSERT INTO tasks (course_id, title, description, language, starter_code, mode, rules, tests, kind,"
              " position, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
              (cid, t["title"], t["description"], t["language"], t["starter_code"], t["mode"],
               json.dumps(t["rules"], ensure_ascii=False), json.dumps(t["tests"], ensure_ascii=False),
               t.get("kind", "study"), pos, now))
    return True
