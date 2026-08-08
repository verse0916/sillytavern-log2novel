#!/usr/bin/env python3
"""Clean SillyTavern JSONL chat exports into plain text."""

import argparse
import json
import re
from pathlib import Path
from typing import Iterable, Optional, Sequence


USER_TAGS = (
    "status_panel",
    "details",
    "recall",
    "supplement",
    "本轮用户输入",
)


def remove_tag_blocks(message: str, tags: Iterable[str]) -> str:
    """Remove complete blocks for the named tags, ignoring case."""
    for tag in tags:
        message = re.sub(
            rf"<{re.escape(tag)}(?=[\s/>])[^>]*>.*?</{re.escape(tag)}\s*>",
            "",
            message,
            flags=re.DOTALL | re.IGNORECASE,
        )
    return message


def remove_orphan_closing_tags(message: str) -> str:
    """Remove malformed numeric closing tags such as </1>."""
    return re.sub(r"</\d+\s*>", "", message)


def clean_ai_message(message: str, tag: str) -> Optional[str]:
    """Extract every matching container block from an AI message."""
    pattern = re.compile(
        rf"<{re.escape(tag)}(?=[\s/>])[^>]*>(.*?)</{re.escape(tag)}\s*>",
        flags=re.DOTALL | re.IGNORECASE,
    )
    matches = [match.strip() for match in pattern.findall(message)]
    if not matches:
        return None
    return remove_orphan_closing_tags("\n\n".join(matches)).strip()


def clean_user_message(message: str) -> str:
    """Keep user input while removing leading OOC notes and known wrappers."""
    message = remove_tag_blocks(message.strip(), USER_TAGS)
    message = re.sub(r"^（[^）]*）\s*", "", message)
    message = re.sub(r"^\([^)]*\)\s*", "", message)
    return message.strip()


def process(input_path: Path, output_path: Path, tag: str = "content") -> None:
    """Read a JSONL export, clean its messages, and write plain text."""
    output_parts = []
    skipped = 0

    with input_path.open("r", encoding="utf-8") as source:
        for line_number, raw_line in enumerate(source, start=1):
            line = raw_line.strip()
            if not line:
                continue

            try:
                obj = json.loads(line)
            except json.JSONDecodeError as error:
                print(f"[警告] 第 {line_number} 行解析失败，已跳过：{error}")
                skipped += 1
                continue

            if not isinstance(obj, dict) or "mes" not in obj:
                # SillyTavern commonly stores metadata as the first JSON object.
                skipped += 1
                continue

            message = obj["mes"]
            if not isinstance(message, str):
                print(f"[警告] 第 {line_number} 行 mes 不是字符串，已跳过")
                skipped += 1
                continue

            if obj.get("is_user", False):
                cleaned = clean_user_message(message)
            else:
                extracted = clean_ai_message(message, tag)
                if extracted is None:
                    print(
                        f"[提示] 第 {line_number} 行未找到 <{tag}> 标签，"
                        "已保留原文，建议人工检查"
                    )
                    cleaned = remove_orphan_closing_tags(message).strip()
                else:
                    cleaned = extracted

            if cleaned:
                output_parts.append(cleaned)

    final = "\n\n".join(output_parts)
    if final:
        final += "\n"
    output_path.write_text(final, encoding="utf-8")

    print(f"共 {len(output_parts)} 条消息，{len(final)} 字符（跳过 {skipped} 行）")
    print(f"输出文件：{output_path}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="将 SillyTavern 导出的 JSONL 聊天记录清洗为纯文本。"
    )
    parser.add_argument("input", type=Path, help="输入的 .jsonl 文件")
    parser.add_argument("output", nargs="?", type=Path, help="输出的 .txt 文件")
    parser.add_argument(
        "--tag",
        default="content",
        help="AI 正文容器标签名（默认：content）",
    )
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.input.is_file():
        print(f"错误：找不到文件 {args.input}")
        return 1
    if not args.tag or not re.fullmatch(r"[^<>\s/]+", args.tag):
        print("错误：--tag 必须是有效的单个标签名")
        return 1

    output = args.output or args.input.with_name(f"{args.input.stem}_cleaned.txt")
    try:
        process(args.input, output, args.tag)
    except (OSError, UnicodeError) as error:
        print(f"错误：{error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
