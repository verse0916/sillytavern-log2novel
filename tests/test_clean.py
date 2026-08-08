import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import clean


class CleanTests(unittest.TestCase):
    def run_process(self, rows, tag="content"):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "chat.jsonl"
            output = Path(directory) / "chat.txt"
            source.write_text("\n".join(rows), encoding="utf-8")
            terminal = io.StringIO()
            with contextlib.redirect_stdout(terminal):
                clean.process(source, output, tag)
            return output.read_text(encoding="utf-8"), terminal.getvalue()

    def test_all_planned_edge_cases(self):
        rows = [
            json.dumps({"meta": "first line"}, ensure_ascii=False),
            json.dumps(
                {
                    "is_user": False,
                    "mes": "outside<CONTENT> 第一段 </CONTENT>x<content>第二段</content>",
                },
                ensure_ascii=False,
            ),
            json.dumps(
                {"is_user": False, "mes": "旧格式原文</1>"},
                ensure_ascii=False,
            ),
            json.dumps(
                {"is_user": False, "mes": "<content><panel>保留嵌套</panel></content>"},
                ensure_ascii=False,
            ),
            "not json",
            json.dumps({"is_user": False, "mes": "<content>  </content>"}),
            json.dumps(
                {"is_user": True, "mes": "（OOC）用户正文<details>删除</details>"},
                ensure_ascii=False,
            ),
        ]

        result, terminal = self.run_process(rows)

        self.assertEqual(
            result,
            "第一段\n\n第二段\n\n旧格式原文\n\n<panel>保留嵌套</panel>\n\n用户正文\n",
        )
        self.assertIn("第 3 行未找到 <content> 标签", terminal)
        self.assertIn("第 5 行解析失败", terminal)

    def test_first_line_message_is_not_skipped_and_custom_tag_works(self):
        rows = [json.dumps({"is_user": False, "mes": "<body>正文</body>"}, ensure_ascii=False)]
        result, terminal = self.run_process(rows, "body")
        self.assertEqual(result, "正文\n")
        self.assertNotIn("未找到", terminal)

    def test_chinese_custom_tag_and_user_wrapper(self):
        rows = [
            json.dumps(
                {
                    "is_user": False,
                    "mes": "<thinking>忽略</thinking><丢失文稿修复>小说正文</丢失文稿修复>",
                },
                ensure_ascii=False,
            ),
            json.dumps(
                {
                    "is_user": True,
                    "mes": "<本轮用户输入>包装内容</本轮用户输入>应保留内容",
                },
                ensure_ascii=False,
            ),
        ]

        result, terminal = self.run_process(rows, "丢失文稿修复")

        self.assertEqual(result, "小说正文\n\n应保留内容\n")
        self.assertNotIn("未找到", terminal)

    def test_bare_tag_in_thinking_does_not_capture_prompt(self):
        rows = [
            json.dumps(
                {
                    "is_user": False,
                    "mes": (
                        "<thinking>输出格式：<content>\n<count>\n状态栏\n"
                        "</thinking>\n<content>真正的小说正文</content>"
                        "<count>123</count>"
                    ),
                },
                ensure_ascii=False,
            )
        ]

        result, terminal = self.run_process(rows)

        self.assertEqual(result, "真正的小说正文\n")
        self.assertNotIn("未找到", terminal)


if __name__ == "__main__":
    unittest.main()
