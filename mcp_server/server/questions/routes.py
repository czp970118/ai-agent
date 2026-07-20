"""题库导入 API：/chat/questions/*"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .bank_store import (
    confirm_import,
    delete_questions,
    get_question,
    list_questions,
    patch_question,
    recall_random_questions,
)
from .daily_quiz_publish import publish_daily_quiz
from .extract import combine_volume_texts, extract_document_bytes, normalize_extension, validate_extracted_text
from .import_config import allowed_upload_extensions, upload_config_payload
from .import_store import (
    create_import_record,
    delete_import_items,
    file_sha256,
    get_import,
    insert_import_items,
    patch_import_item,
    update_import_status,
)
from .parse_llm import parse_questions_from_text, split_text_chunks
from .storage import (
    read_extracted_answer_text,
    read_extracted_question_text,
    read_extracted_text,
    save_extracted_answer_text,
    save_extracted_question_text,
    save_extracted_text,
    save_source_file,
)


def max_upload_bytes() -> int:
    raw = os.getenv("QUESTION_IMPORT_MAX_BYTES", str(20 * 1024 * 1024)).strip()
    try:
        return max(1024, int(raw))
    except ValueError:
        return 20 * 1024 * 1024


def text_preview_max_chars() -> int:
    raw = os.getenv("QUESTION_IMPORT_TEXT_PREVIEW_CHARS", "80000").strip()
    try:
        return max(1000, int(raw))
    except ValueError:
        return 80000


def _extract_stats(text: str) -> dict[str, int | bool]:
    body = str(text or "")
    limit = text_preview_max_chars()
    chunks = split_text_chunks(body)
    return {
        "charCount": len(body),
        "estimatedLlmCalls": len(chunks) or (1 if body else 0),
        "extractedTextTruncated": len(body) > limit,
    }


def _build_extract_preview(
    *,
    question_text: str,
    answer_text: str,
    question_format: str,
    answer_format: str,
) -> dict[str, Any]:
    limit = text_preview_max_chars()
    q_body = str(question_text or "")
    a_body = str(answer_text or "")
    combined = combine_volume_texts(q_body, a_body)
    stats = _extract_stats(combined)
    return {
        "questionText": q_body[:limit],
        "answerText": a_body[:limit] if a_body else "",
        "questionCharCount": len(q_body),
        "answerCharCount": len(a_body),
        "questionTruncated": len(q_body) > limit,
        "answerTruncated": len(a_body) > limit if a_body else False,
        "questionFormat": question_format,
        "answerFormat": answer_format,
        "charCount": stats["charCount"],
        "estimatedLlmCalls": stats["estimatedLlmCalls"],
        "extractedTextTruncated": stats["extractedTextTruncated"],
        # 兼容旧字段：合并预览
        "extractedText": combined[:limit],
    }


async def _load_import_text(import_id: str) -> tuple[str, str]:
    from .import_store import _connect

    with _connect() as conn:
        row = conn.execute(
            "SELECT extracted_text_path, category FROM question_imports WHERE id = ?",
            (import_id,),
        ).fetchone()
    if not row or not str(row["extracted_text_path"] or "").strip():
        raise HTTPException(status_code=400, detail="缺少提取文本，请重新上传")
    try:
        text = read_extracted_text(str(row["extracted_text_path"]))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return text, str(row["category"] or "")


class ImportItemPatch(BaseModel):
    header: str | None = None
    stem: str | None = None
    options: list[str] | None = None
    answer: str | None = None
    explanation: str | None = None
    extraTitle: str | None = None
    extraText: str | None = None
    category: str | None = None
    subjectDomain: str | None = Field(default=None, alias="subject_domain")
    questionType: str | None = None
    selected: bool | None = None


class ConfirmImportBody(BaseModel):
    itemIds: list[str] | None = Field(default=None, alias="item_ids")
    tags: list[str] = Field(default_factory=list)
    isRealExam: bool = Field(default=False, alias="is_real_exam")
    examYear: str = Field(default="", alias="exam_year")
    examRegion: str = Field(default="", alias="exam_region")
    examKind: str = Field(default="", alias="exam_kind")

    model_config = {"populate_by_name": True}


class PasteImportBody(BaseModel):
    category: str = ""
    question_text: str = ""
    answer_text: str = ""

    model_config = {"populate_by_name": True}


class RecallQuestionsBody(BaseModel):
    count: int = 7
    excludeIds: list[str] = Field(default_factory=list, alias="exclude_ids")
    category: str = ""
    subjectDomain: str = Field(default="", alias="subject_domain")
    tags: list[str] = Field(default_factory=list)
    realExamFilter: str = Field(default="all", alias="real_exam_filter")

    model_config = {"populate_by_name": True}


class DailyQuizPublishSlot(BaseModel):
    questionId: str = Field(alias="question_id")
    stem: str = ""
    options: list[str] = Field(default_factory=list)
    answer: str = ""
    explanation: str = ""
    questionPath: str = Field(alias="question_path")
    answerPath: str = Field(alias="answer_path")

    model_config = {"populate_by_name": True}


class DailyQuizPublishBody(BaseModel):
    workId: str = Field(alias="work_id")
    title: str | None = None
    category: str = ""
    slots: list[DailyQuizPublishSlot] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class QuestionBankPatch(BaseModel):
    header: str | None = None
    stem: str | None = None
    options: list[str] | None = None
    answer: str | None = None
    explanation: str | None = None
    extraTitle: str | None = None
    extraText: str | None = None
    category: str | None = None
    subjectDomain: str | None = Field(default=None, alias="subject_domain")
    tags: list[str] | None = None
    isRealExam: bool | None = Field(default=None, alias="is_real_exam")
    examYear: str | None = Field(default=None, alias="exam_year")
    examRegion: str | None = Field(default=None, alias="exam_region")
    examKind: str | None = Field(default=None, alias="exam_kind")

    model_config = {"populate_by_name": True}


class DeleteQuestionsBody(BaseModel):
    ids: list[str] = Field(default_factory=list)


async def _run_parse_pipeline(import_id: str, text: str, category: str) -> dict[str, Any]:
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        update_import_status(
            import_id,
            status="parse_failed",
            parse_error="缺少环境变量 DEEPSEEK_API_KEY",
        )
        raise HTTPException(status_code=500, detail="缺少环境变量 DEEPSEEK_API_KEY")

    model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    update_import_status(import_id, status="parsing")

    result = await parse_questions_from_text(
        text,
        default_category=category,
        api_key=api_key,
        model=model,
    )

    parse_payload = {
        "warnings": result.get("warnings") or [],
        "raw_blocks": result.get("raw_blocks") or [],
        "error": result.get("error") or "",
    }
    parse_json = json.dumps(parse_payload, ensure_ascii=False)

    if not result.get("ok"):
        err = str(result.get("error") or "解析失败")
        update_import_status(
            import_id,
            status="parse_failed",
            parse_error=err,
            parse_result_json=parse_json,
            question_count=0,
        )
        imp = get_import(import_id)
        return {
            "ok": False,
            "import": imp,
            "items": [],
            "warnings": parse_payload["warnings"],
            "error": err,
        }

    questions = result.get("questions") or []
    items = insert_import_items(import_id, questions)
    update_import_status(
        import_id,
        status="parsed",
        parse_error="",
        parse_result_json=parse_json,
        question_count=len(items),
    )
    imp = get_import(import_id)
    return {
        "ok": True,
        "import": imp,
        "items": items,
        "warnings": parse_payload["warnings"],
    }


def register_question_routes(router: APIRouter) -> None:
    @router.get("/questions/import/config")
    async def get_questions_import_config() -> dict[str, Any]:
        return {"ok": True, **upload_config_payload(max_upload_bytes=max_upload_bytes())}

    async def _validate_upload_file(upload: UploadFile) -> tuple[bytes, str, str]:
        raw_name = str(upload.filename or "").strip()
        ext = normalize_extension(raw_name)
        allowed = allowed_upload_extensions()
        if ext not in allowed:
            raise HTTPException(
                status_code=400,
                detail="仅支持 " + "、".join(sorted(allowed)) + " 文件",
            )
        data = await upload.read()
        if not data:
            raise HTTPException(status_code=400, detail="文件为空")
        if len(data) > max_upload_bytes():
            raise HTTPException(status_code=400, detail=f"文件超过 {max_upload_bytes()} 字节上限")
        return data, ext, raw_name or f"source{ext}"

    async def _create_extracted_import(
        *,
        import_id: str,
        category: str,
        display_name: str,
        total_size: int,
        file_hash: str,
        source_path: str,
        q_text: str,
        a_text: str,
        q_ext: str,
        a_fmt: str,
        answer_volume: bool,
    ) -> dict[str, Any]:
        cat = str(category or "").strip()
        create_import_record(
            filename=display_name,
            mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            file_size=total_size,
            file_sha256=file_hash,
            source_path=source_path,
            category=cat,
            import_id=import_id,
        )

        update_import_status(import_id, status="extracting")
        try:
            text = combine_volume_texts(q_text, a_text)
            validate_ext = q_ext or a_fmt or ".docx"
            validate_extracted_text(text, ext=validate_ext)
            save_extracted_question_text(import_id, q_text)
            save_extracted_answer_text(import_id, a_text)
            extracted_path = save_extracted_text(import_id, text)
            update_import_status(
                import_id,
                extracted_text_path=extracted_path,
                extract_error="",
            )
        except ValueError as exc:
            update_import_status(
                import_id,
                status="extract_failed",
                extract_error=str(exc),
            )
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        update_import_status(
            import_id,
            status="text_extracted",
            filename=display_name,
            file_size=total_size,
            file_sha256=file_hash,
        )

        imp = get_import(import_id)
        preview = _build_extract_preview(
            question_text=q_text,
            answer_text=a_text,
            question_format=q_ext,
            answer_format=a_fmt,
        )
        return {
            "ok": True,
            "import": imp,
            "hasAnswerVolume": answer_volume,
            **preview,
            "items": [],
            "warnings": [],
        }

    @router.post("/questions/import/upload")
    async def post_questions_import_upload(
        files: Optional[list[UploadFile]] = File(None),
        file: Optional[UploadFile] = File(None),
        answer_file: Optional[UploadFile] = File(None),
        category: str = Form(""),
    ) -> dict[str, Any]:
        upload_list: list[UploadFile] = []
        if files:
            upload_list.extend([f for f in files if str(f.filename or "").strip()])
        if file and str(file.filename or "").strip():
            upload_list.append(file)
        if answer_file and str(answer_file.filename or "").strip():
            upload_list.append(answer_file)
        if not upload_list:
            raise HTTPException(status_code=400, detail="请至少上传一个 .docx 文件")

        import_id = str(uuid4())
        extracted_texts: list[str] = []
        file_names: list[str] = []
        total_size = 0
        sha_payload = b""
        q_ext = ".docx"
        a_fmt = ""
        source_path = ""

        for idx, upload in enumerate(upload_list):
            data, ext, name = await _validate_upload_file(upload)
            text = extract_document_bytes(data, ext=ext)
            extracted_texts.append(text)
            file_names.append(name)
            total_size += len(data)
            sha_payload += data
            try:
                if idx == 0:
                    source_path = save_source_file(import_id, data, ext, role="question")
                    q_ext = ext
                elif idx == 1:
                    save_source_file(import_id, data, ext, role="answer")
                    a_fmt = ext
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

        if len(extracted_texts) == 2:
            q_text, a_text = extracted_texts[0], extracted_texts[1]
        else:
            q_text = "\n\n".join(extracted_texts)
            a_text = ""

        if len(file_names) == 1:
            display_name = file_names[0]
        elif len(file_names) == 2:
            display_name = f"{file_names[0]} | 解析:{file_names[1]}"
        else:
            display_name = f"{file_names[0]} 等 {len(file_names)} 个文件"

        file_hash = file_sha256(sha_payload)
        answer_volume = bool(a_text.strip())
        return await _create_extracted_import(
            import_id=import_id,
            category=category,
            display_name=display_name,
            total_size=total_size,
            file_hash=file_hash,
            source_path=source_path,
            q_text=q_text,
            a_text=a_text,
            q_ext=q_ext,
            a_fmt=a_fmt,
            answer_volume=answer_volume,
        )

    @router.post("/questions/import/paste")
    async def post_questions_import_paste(body: PasteImportBody) -> dict[str, Any]:
        q_text = str(body.question_text or "").strip()
        a_text = str(body.answer_text or "").strip()
        if not q_text and not a_text:
            raise HTTPException(status_code=400, detail="请至少粘贴题目或解析文案之一")

        import_id = str(uuid4())
        display_name = "粘贴导入"
        if q_text and a_text:
            display_name = "粘贴导入（题目+解析）"
        elif a_text:
            display_name = "粘贴导入（解析）"

        return await _create_extracted_import(
            import_id=import_id,
            category=body.category,
            display_name=display_name,
            total_size=len(q_text) + len(a_text),
            file_hash=file_sha256(f"{q_text}\n{a_text}".encode("utf-8")),
            source_path="",
            q_text=q_text,
            a_text=a_text,
            q_ext=".txt",
            a_fmt=".txt" if a_text else "",
            answer_volume=bool(a_text),
        )

    @router.get("/questions/import/{import_id}/extracted-text")
    async def get_questions_import_extracted_text(import_id: str) -> dict[str, Any]:
        try:
            get_import(import_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        import_id = str(import_id or "").strip()
        q_text = read_extracted_question_text(import_id)
        a_text = read_extracted_answer_text(import_id)
        from .import_store import _connect
        from .storage import import_dir as _import_dir

        q_fmt = ".docx"
        a_fmt = ""
        with _connect() as conn:
            row = conn.execute(
                "SELECT source_path FROM question_imports WHERE id = ?",
                (import_id,),
            ).fetchone()
        if row and str(row["source_path"] or "").strip():
            q_fmt = Path(str(row["source_path"])).suffix.lower() or ".docx"
        vol_dir = _import_dir(import_id)
        answer_path = vol_dir / "source-answer.docx"
        if answer_path.is_file():
            a_fmt = ".docx"
        preview = _build_extract_preview(
            question_text=q_text,
            answer_text=a_text,
            question_format=q_fmt or ".docx",
            answer_format=a_fmt,
        )
        return {"ok": True, **preview}

    @router.post("/questions/import/{import_id}/parse")
    async def post_questions_import_parse(import_id: str) -> dict[str, Any]:
        imp = get_import(import_id)
        if imp["status"] not in ("text_extracted", "parse_failed", "parsed"):
            raise HTTPException(status_code=400, detail="请先完成文字提取")
        text, cat = await _load_import_text(import_id)
        delete_import_items(import_id)
        return await _run_parse_pipeline(import_id, text, cat)

    @router.patch("/questions/import/{import_id}/items/{item_id}")
    async def patch_questions_import_item(
        import_id: str,
        item_id: str,
        body: ImportItemPatch,
    ) -> dict[str, Any]:
        imp = get_import(import_id)
        if imp["status"] not in ("parsed", "parse_failed"):
            raise HTTPException(status_code=400, detail="当前批次不可编辑预览项")
        patch = body.model_dump(exclude_unset=True)
        try:
            item = patch_import_item(import_id, item_id, patch)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "item": item}

    @router.post("/questions/import/{import_id}/confirm")
    async def post_questions_import_confirm(
        import_id: str,
        body: ConfirmImportBody | None = None,
    ) -> dict[str, Any]:
        item_ids = body.itemIds if body else None
        tags = body.tags if body else []
        is_real_exam = body.isRealExam if body else False
        exam_year = body.examYear if body else ""
        exam_region = body.examRegion if body else ""
        exam_kind = body.examKind if body else ""
        try:
            return confirm_import(
                import_id,
                item_ids=item_ids,
                tags=tags,
                is_real_exam=is_real_exam,
                exam_year=exam_year,
                exam_region=exam_region,
                exam_kind=exam_kind,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/questions/import/{import_id}/reparse")
    async def post_questions_import_reparse(import_id: str) -> dict[str, Any]:
        """与 /parse 相同：基于已存 extracted.txt 重新跑 DeepSeek。"""
        imp = get_import(import_id)
        if imp["status"] not in ("text_extracted", "parse_failed", "parsed"):
            raise HTTPException(status_code=400, detail="当前状态不可重新解析")
        text, cat = await _load_import_text(import_id)
        delete_import_items(import_id)
        return await _run_parse_pipeline(import_id, text, cat)

    @router.get("/questions")
    async def get_questions_bank(
        status: str = "ready",
        category: str = "",
        subject_domain: str = "",
        usage: str = "",
        tags: str = "",
        keyword: str = "",
        limit: int = 100,
        offset: int = 0,
    ) -> dict[str, Any]:
        from .tags import normalize_tags

        tag_list = normalize_tags([t.strip() for t in str(tags or "").split(",") if t.strip()])
        data = list_questions(
            status=status,
            category=category,
            subject_domain=str(subject_domain or "").strip(),
            usage=usage,
            tags=tag_list or None,
            keyword=str(keyword or "").strip(),
            limit=limit,
            offset=offset,
        )
        return {"ok": True, **data}

    @router.get("/questions/{question_id}")
    async def get_questions_bank_item(question_id: str) -> dict[str, Any]:
        try:
            item = get_question(question_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"ok": True, "item": item}

    @router.patch("/questions/{question_id}")
    async def patch_questions_bank_item(
        question_id: str,
        body: QuestionBankPatch,
    ) -> dict[str, Any]:
        patch = body.model_dump(exclude_unset=True)
        try:
            item = patch_question(question_id, patch)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "item": item}

    @router.delete("/questions/{question_id}")
    async def delete_questions_bank_item(question_id: str) -> dict[str, Any]:
        result = delete_questions([question_id])
        if result["deleted"] == 0:
            raise HTTPException(status_code=404, detail="题目不存在")
        return {"ok": True, **result}

    @router.post("/questions/delete-batch")
    async def post_questions_delete_batch(body: DeleteQuestionsBody) -> dict[str, Any]:
        if not body.ids:
            raise HTTPException(status_code=400, detail="请选择要删除的题目")
        return {"ok": True, **delete_questions(body.ids)}

    @router.post("/questions/recall")
    async def post_questions_recall(body: RecallQuestionsBody) -> dict[str, Any]:
        data = recall_random_questions(
            count=body.count,
            exclude_ids=body.excludeIds,
            category=str(body.category or "").strip(),
            subject_domain=str(body.subjectDomain or "").strip(),
            tags=body.tags,
            real_exam_filter=body.realExamFilter,
        )
        if not data.get("items"):
            detail = "题库中没有可召回的未使用题目"
            filt = str(body.realExamFilter or "all").strip().lower()
            if filt == "only":
                detail = "题库中没有符合条件的未使用真题"
            elif filt == "exclude":
                detail = "题库中没有符合条件的未使用非真题"
            if body.excludeIds:
                detail += "（可能已全部在排除列表中或均已发布过）"
            raise HTTPException(status_code=400, detail=detail)
        return {"ok": True, **data}

    @router.post("/questions/daily-quiz/publish")
    async def post_daily_quiz_publish(body: DailyQuizPublishBody) -> dict[str, Any]:
        if not body.slots:
            raise HTTPException(status_code=400, detail="slots 不能为空")
        try:
            slots_payload = [
                {
                    "questionId": s.questionId,
                    "stem": s.stem,
                    "questionPath": s.questionPath,
                    "answerPath": s.answerPath,
                }
                for s in body.slots
            ]
            return publish_daily_quiz(
                work_id=body.workId,
                slots=slots_payload,
                title=body.title,
                category=str(body.category or "").strip(),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
