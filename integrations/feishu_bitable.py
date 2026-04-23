import json
import os
from typing import Any

import httpx


FEISHU_TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
FEISHU_CREATE_APP_URL = "https://open.feishu.cn/open-apis/bitable/v1/apps"
FEISHU_LIST_TABLES_URL = "https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables"
FEISHU_BATCH_CREATE_RECORDS_URL = (
    "https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_create"
)
FEISHU_LIST_FIELDS_URL = (
    "https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/fields"
)
FEISHU_CREATE_FIELD_URL = (
    "https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/fields"
)

# 飞书字段类型：1=文本，2=数字。
TARGET_BTABLE_FIELDS: dict[str, int] = {
    "ID": 1,
    "笔记地址": 1,
    "图片": 1,
    "标题": 1,
    "点赞数": 2,
    "收藏数": 2,
    "内容": 1,
    "作者": 1,
}


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(str(value))
    except Exception:
        return default


def _extract_note_records(search_payload: dict[str, Any], keyword: str) -> list[dict[str, Any]]:
    data = search_payload.get("data") if isinstance(search_payload, dict) else None
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []

    records: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("model_type") != "note":
            continue

        note_card = item.get("note_card")
        if not isinstance(note_card, dict):
            continue

        user = note_card.get("user") if isinstance(note_card.get("user"), dict) else {}
        interact = (
            note_card.get("interact_info")
            if isinstance(note_card.get("interact_info"), dict)
            else {}
        )
        cover = note_card.get("cover") if isinstance(note_card.get("cover"), dict) else {}

        note_id = item.get("id", "")
        xsec_token = item.get("xsec_token", "")
        note_url = ""
        if note_id and xsec_token:
            note_url = f"https://www.xiaohongshu.com/explore/{note_id}?xsec_token={xsec_token}"

        title = str(note_card.get("display_title") or "")
        content = str(note_card.get("desc") or title)
        fields = {
            "ID": str(note_id or ""),
            "笔记地址": note_url,
            "图片": str(cover.get("url_default") or ""),
            "标题": title,
            "点赞数": _as_int(interact.get("liked_count")),
            "收藏数": _as_int(interact.get("collected_count")),
            "内容": content,
            "作者": str(user.get("nickname") or user.get("nick_name") or ""),
            # 额外保留关键词，便于未来扩展，但默认不写入飞书字段。
            "_keyword": keyword,
        }
        records.append({"fields": fields})
    return records


async def get_feishu_tenant_access_token(
    app_id: str,
    app_secret: str,
    timeout_seconds: float = 20.0,
) -> str:
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        resp = await client.post(
            FEISHU_TOKEN_URL,
            json={"app_id": app_id, "app_secret": app_secret},
        )
        resp.raise_for_status()
        payload = resp.json()

    if payload.get("code") != 0:
        raise RuntimeError(
            f"飞书获取 tenant_access_token 失败: code={payload.get('code')}, msg={payload.get('msg')}"
        )
    token = payload.get("tenant_access_token")
    if not token:
        raise RuntimeError("飞书 tenant_access_token 为空")
    return token


async def create_bitable_app(
    tenant_access_token: str,
    app_name: str,
    folder_token: str | None = None,
    timeout_seconds: float = 30.0,
) -> dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {tenant_access_token}",
        "Content-Type": "application/json; charset=utf-8",
    }
    body: dict[str, Any] = {"name": app_name}
    if folder_token:
        body["folder_token"] = folder_token
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        resp = await client.post(FEISHU_CREATE_APP_URL, headers=headers, json=body)
        resp.raise_for_status()
        payload = resp.json()
    if payload.get("code") != 0:
        raise RuntimeError(
            f"飞书创建多维表失败: code={payload.get('code')}, msg={payload.get('msg')}"
        )
    data = payload.get("data")
    if not isinstance(data, dict):
        raise RuntimeError("飞书创建多维表成功但返回结构异常")
    app_obj = data.get("app")
    if not isinstance(app_obj, dict) or not app_obj.get("app_token"):
        raise RuntimeError("飞书创建多维表成功但未返回 app_token")
    return app_obj


async def list_bitable_tables(
    app_token: str,
    tenant_access_token: str,
    timeout_seconds: float = 30.0,
) -> list[dict[str, Any]]:
    url = FEISHU_LIST_TABLES_URL.format(app_token=app_token)
    headers = {"Authorization": f"Bearer {tenant_access_token}"}
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        resp = await client.get(url, headers=headers, params={"page_size": 200})
        resp.raise_for_status()
        payload = resp.json()
    if payload.get("code") != 0:
        raise RuntimeError(
            f"飞书读取数据表失败: code={payload.get('code')}, msg={payload.get('msg')}"
        )
    items = payload.get("data", {}).get("items", [])
    return items if isinstance(items, list) else []


async def batch_create_bitable_records(
    app_token: str,
    table_id: str,
    tenant_access_token: str,
    records: list[dict[str, Any]],
    timeout_seconds: float = 30.0,
) -> dict[str, Any]:
    if not records:
        return {"code": 0, "msg": "no records", "data": {"records": []}}

    url = FEISHU_BATCH_CREATE_RECORDS_URL.format(app_token=app_token, table_id=table_id)
    headers = {
        "Authorization": f"Bearer {tenant_access_token}",
        "Content-Type": "application/json; charset=utf-8",
    }
    created_records: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        for i in range(0, len(records), 500):
            chunk = records[i : i + 500]
            resp = await client.post(url, headers=headers, json={"records": chunk})
            resp.raise_for_status()
            payload = resp.json()
            if payload.get("code") != 0:
                raise RuntimeError(
                    f"飞书写入多维表失败: code={payload.get('code')}, msg={payload.get('msg')}"
                )
            data = payload.get("data")
            if isinstance(data, dict):
                part = data.get("records")
                if isinstance(part, list):
                    created_records.extend(part)
    return {"code": 0, "msg": "success", "data": {"records": created_records}}


async def _list_bitable_fields(
    app_token: str,
    table_id: str,
    tenant_access_token: str,
    timeout_seconds: float = 30.0,
) -> list[dict[str, Any]]:
    url = FEISHU_LIST_FIELDS_URL.format(app_token=app_token, table_id=table_id)
    headers = {"Authorization": f"Bearer {tenant_access_token}"}
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        resp = await client.get(url, headers=headers, params={"page_size": 500})
        resp.raise_for_status()
        payload = resp.json()
    if payload.get("code") != 0:
        raise RuntimeError(
            f"飞书读取字段失败: code={payload.get('code')}, msg={payload.get('msg')}"
        )
    items = payload.get("data", {}).get("items", [])
    return items if isinstance(items, list) else []


async def _create_bitable_field(
    app_token: str,
    table_id: str,
    tenant_access_token: str,
    field_name: str,
    field_type: int,
    timeout_seconds: float = 30.0,
) -> None:
    url = FEISHU_CREATE_FIELD_URL.format(app_token=app_token, table_id=table_id)
    headers = {
        "Authorization": f"Bearer {tenant_access_token}",
        "Content-Type": "application/json; charset=utf-8",
    }
    body = {"field_name": field_name, "type": field_type}
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        resp = await client.post(url, headers=headers, json=body)
        resp.raise_for_status()
        payload = resp.json()
    if payload.get("code") != 0:
        raise RuntimeError(
            f"飞书创建字段失败({field_name}): code={payload.get('code')}, msg={payload.get('msg')}"
        )


async def ensure_bitable_fields(
    app_token: str,
    table_id: str,
    tenant_access_token: str,
) -> dict[str, Any]:
    items = await _list_bitable_fields(app_token, table_id, tenant_access_token)
    existing_names = {
        str(item.get("field_name"))
        for item in items
        if isinstance(item, dict) and item.get("field_name")
    }
    created: list[str] = []
    for field_name, field_type in TARGET_BTABLE_FIELDS.items():
        if field_name in existing_names:
            continue
        await _create_bitable_field(
            app_token=app_token,
            table_id=table_id,
            tenant_access_token=tenant_access_token,
            field_name=field_name,
            field_type=field_type,
        )
        created.append(field_name)
    return {"created_fields": created}


async def upload_xhs_search_to_feishu_bitable(
    xhs_search_text: str,
    keyword: str,
    app_token: str,
    table_id: str,
    app_id: str | None = None,
    app_secret: str | None = None,
    tenant_access_token: str | None = None,
    create_new_app_each_upload: bool = False,
    new_app_name: str | None = None,
    new_app_folder_token: str | None = None,
) -> dict[str, Any]:
    if not xhs_search_text:
        raise ValueError("xhs 搜索结果为空")

    payload = json.loads(xhs_search_text)
    records = _extract_note_records(payload, keyword=keyword)

    tk = tenant_access_token
    if not tk:
        final_app_id = app_id or os.environ.get("FEISHU_APP_ID")
        final_app_secret = app_secret or os.environ.get("FEISHU_APP_SECRET")
        if not final_app_id or not final_app_secret:
            raise ValueError("未提供飞书 tenant_access_token，且缺少 app_id/app_secret")
        tk = await get_feishu_tenant_access_token(
            app_id=final_app_id,
            app_secret=final_app_secret,
        )

    effective_app_token = app_token
    effective_table_id = table_id
    new_app_info: dict[str, Any] | None = None
    if create_new_app_each_upload:
        app_name = (
            new_app_name
            or f"{keyword}_{__import__('time').strftime('%Y%m%d_%H%M%S')}"
        )
        folder_token = new_app_folder_token or os.environ.get("FEISHU_BITABLE_FOLDER_TOKEN")
        created_app = await create_bitable_app(
            tenant_access_token=tk,
            app_name=app_name,
            folder_token=folder_token,
        )
        effective_app_token = str(created_app.get("app_token"))
        effective_table_id = str(created_app.get("default_table_id") or "")
        if not effective_table_id:
            tables = await list_bitable_tables(
                app_token=effective_app_token,
                tenant_access_token=tk,
            )
            if not tables:
                raise RuntimeError("新建多维表后未获取到默认数据表(table)")
            first_table = tables[0]
            effective_table_id = str(first_table.get("table_id") or first_table.get("id") or "")
        if not effective_table_id:
            raise RuntimeError("新建多维表后未获取到 table_id")
        new_app_info = {
            "app_name": app_name,
            "app_token": effective_app_token,
            "table_id": effective_table_id,
            "app_url": created_app.get("url"),
        }

    field_sync_result = await ensure_bitable_fields(
        app_token=effective_app_token,
        table_id=effective_table_id,
        tenant_access_token=tk,
    )
    # 仅保留目标字段，避免把内部字段写入飞书。
    sanitized_records = []
    for record in records:
        fields = record.get("fields", {})
        if not isinstance(fields, dict):
            continue
        sanitized_records.append(
            {
                "fields": {
                    k: fields.get(k, "")
                    for k in TARGET_BTABLE_FIELDS.keys()
                }
            }
        )

    feishu_resp = await batch_create_bitable_records(
        app_token=effective_app_token,
        table_id=effective_table_id,
        tenant_access_token=tk,
        records=sanitized_records,
    )
    created_records = (
        feishu_resp.get("data", {}).get("records", [])
        if isinstance(feishu_resp.get("data"), dict)
        else []
    )
    return {
        "input_note_count": len(sanitized_records),
        "created_count": len(created_records) if isinstance(created_records, list) else 0,
        "field_sync_result": field_sync_result,
        "target_table": {
            "app_token": effective_app_token,
            "table_id": effective_table_id,
        },
        "new_app_info": new_app_info,
        "feishu_response": feishu_resp,
    }


async def post_upload_callback(
    callback_url: str,
    payload: dict[str, Any],
    callback_timeout_seconds: float = 10.0,
) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=callback_timeout_seconds) as client:
        resp = await client.post(callback_url, json=payload)
        text = resp.text
        status_code = resp.status_code
    return {"status_code": status_code, "body": text[:2000]}
