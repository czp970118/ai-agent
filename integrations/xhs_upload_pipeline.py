import json
import os

from integrations.feishu_bitable import post_upload_callback, upload_xhs_search_to_feishu_bitable
from server.xhs.xhs_search import search_xhs_hot


def _is_search_failed(search_text: str) -> bool:
    return (
        search_text.startswith("请求失败:")
        or search_text.startswith("搜索失败:")
        or search_text.startswith("未提供 x-s")
        or search_text.startswith("未安装 Playwright")
        or search_text.startswith("浏览器抓取超时")
        or search_text.startswith("Playwright 执行失败")
    )


async def search_upload_and_callback(
    keyword: str,
    feishu_app_token: str | None = None,
    feishu_table_id: str | None = None,
    callback_url: str | None = None,
    timeout_seconds: float = 30.0,
    search_id: str | None = None,
    page: int = 1,
    page_size: int = 20,
    sort: str = "general",
    note_type: int = 0,
    geo: str = "",
    image_formats: list[str] | None = None,
    ext_flags: list | None = None,
    filters: list[dict] | None = None,
    x_s: str | None = None,
    x_s_common: str | None = None,
    x_t: str | None = None,
    x_b3_traceid: str | None = None,
    x_xray_traceid: str | None = None,
    feishu_app_id: str | None = None,
    feishu_app_secret: str | None = None,
    feishu_tenant_access_token: str | None = None,
    create_new_app_each_upload: bool | None = None,
    new_app_name: str | None = None,
    new_app_folder_token: str | None = None,
    callback_timeout_seconds: float = 10.0,
) -> str:
    """执行：小红书搜索 -> 飞书多维表上传 -> 回调通知。"""
    app_token = feishu_app_token or os.environ.get("FEISHU_BITABLE_APP_TOKEN")
    table_id = feishu_table_id or os.environ.get("FEISHU_BITABLE_TABLE_ID")
    if create_new_app_each_upload is None:
        create_new_app_each_upload = (
            os.environ.get("FEISHU_CREATE_NEW_APP_EACH_UPLOAD", "0").strip().lower()
            in ("1", "true", "yes")
        )
    cb_url = callback_url or os.environ.get("FEISHU_CALLBACK_URL")
    if not app_token and not create_new_app_each_upload:
        return json.dumps(
            {"ok": False, "stage": "upload", "error": "缺少 FEISHU_BITABLE_APP_TOKEN"},
            ensure_ascii=False,
        )
    if not table_id and not create_new_app_each_upload:
        return json.dumps(
            {"ok": False, "stage": "upload", "error": "缺少 FEISHU_BITABLE_TABLE_ID"},
            ensure_ascii=False,
        )
    search_text = await search_xhs_hot(
        keyword=keyword,
        timeout_seconds=timeout_seconds,
        search_id=search_id,
        page=page,
        page_size=page_size,
        sort=sort,
        note_type=note_type,
        geo=geo,
        image_formats=image_formats,
        ext_flags=ext_flags,
        filters=filters,
        x_s=x_s,
        x_s_common=x_s_common,
        x_t=x_t,
        x_b3_traceid=x_b3_traceid,
        x_xray_traceid=x_xray_traceid,
    )

    if _is_search_failed(search_text):
        return json.dumps(
            {"ok": False, "stage": "search", "error": search_text},
            ensure_ascii=False,
        )

    try:
        upload_result = await upload_xhs_search_to_feishu_bitable(
            xhs_search_text=search_text,
            keyword=keyword,
            app_token=app_token,
            table_id=table_id,
            app_id=feishu_app_id,
            app_secret=feishu_app_secret,
            tenant_access_token=feishu_tenant_access_token,
            create_new_app_each_upload=bool(create_new_app_each_upload),
            new_app_name=new_app_name,
            new_app_folder_token=new_app_folder_token,
        )
    except Exception as e:
        return json.dumps(
            {"ok": False, "stage": "upload", "error": str(e)},
            ensure_ascii=False,
        )

    callback_result = {"status_code": 0, "body": "callback skipped"}
    if cb_url:
        callback_payload = {
            "ok": True,
            "stage": "done",
            "keyword": keyword,
            "upload_result": upload_result,
        }
        try:
            callback_result = await post_upload_callback(
                callback_url=cb_url,
                payload=callback_payload,
                callback_timeout_seconds=callback_timeout_seconds,
            )
        except Exception as e:
            callback_result = {"status_code": 0, "body": f"callback failed: {e}"}

    return json.dumps(
        {
            "ok": True,
            "search_result": json.loads(search_text),
            "upload_result": upload_result,
            "callback_result": callback_result,
        },
        ensure_ascii=False,
    )
