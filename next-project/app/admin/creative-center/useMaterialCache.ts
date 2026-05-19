"use client";

import { useCallback, useRef, useState } from "react";
import type { MaterialCacheState, StreamSuccessPayload } from "./DraftStreamCreation";
import {
  fetchMaterialCacheNotes,
  MATERIAL_CACHE_PAGE_SIZE,
  type MaterialCacheQuery,
} from "./materialCacheNotes";

export function emptyMaterialCacheState(): MaterialCacheState {
  return { loading: false, hint: null, notes: [], page: 0, total: 0, hasMore: false };
}

function queryFromPayload(payload: StreamSuccessPayload): MaterialCacheQuery {
  return {
    keyword: (payload.searchTerms[0] ?? "").trim(),
    domain: payload.domain.trim() || undefined,
  };
}

export function useMaterialCache() {
  const [materialCache, setMaterialCache] = useState<MaterialCacheState>(emptyMaterialCacheState);
  const queryRef = useRef<MaterialCacheQuery | null>(null);
  const pageRef = useRef(0);
  const referencesRef = useRef<StreamSuccessPayload["references"]>([]);

  const resetMaterialCache = useCallback(() => {
    queryRef.current = null;
    pageRef.current = 0;
    referencesRef.current = [];
    setMaterialCache(emptyMaterialCacheState());
  }, []);

  const loadPage = useCallback(async (query: MaterialCacheQuery, pageNum: number) => {
    setMaterialCache((prev) => ({
      ...prev,
      loading: true,
      hint: null,
      notes: [],
    }));
    const result = await fetchMaterialCacheNotes(query, {
      offset: pageNum * MATERIAL_CACHE_PAGE_SIZE,
      references: pageNum === 0 ? referencesRef.current : undefined,
    });
    pageRef.current = pageNum;
    setMaterialCache({
      loading: false,
      hint: result.hint,
      notes: result.items,
      page: pageNum + 1,
      total: result.total,
      hasMore: result.hasMore,
    });
  }, []);

  const fetchLinkedNotes = useCallback(async (payload: StreamSuccessPayload) => {
    const query = queryFromPayload(payload);
    queryRef.current = query;
    referencesRef.current = payload.references;
    pageRef.current = 0;
    await loadPage(query, 0);
  }, [loadPage]);

  const loadNextMaterialBatch = useCallback(async () => {
    const query = queryRef.current;
    if (!query) return;
    await loadPage(query, pageRef.current + 1);
  }, [loadPage]);

  return {
    materialCache,
    fetchLinkedNotes,
    loadNextMaterialBatch,
    resetMaterialCache,
  };
}
