-- ============================================================
-- wacrm — Búsqueda semántica (OPCIONAL: requiere pgvector)
-- Si la extensión no está disponible, el runner de migraciones la
-- omite con un aviso y la base de conocimiento usa solo full-text.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.ai_knowledge_chunks
  ADD COLUMN IF NOT EXISTS embedding public.vector(1536);

CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_embedding_idx
  ON public.ai_knowledge_chunks USING hnsw (embedding public.vector_cosine_ops);

CREATE FUNCTION public.match_ai_knowledge_semantic(p_account_id uuid, p_query_embedding text, p_match_count integer) RETURNS TABLE(id uuid, content text, distance real)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT c.id,
         c.content,
         (c.embedding <=> p_query_embedding::vector(1536)) AS distance
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding::vector(1536)
  LIMIT GREATEST(p_match_count, 0);
$$;

GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer) TO wacrm_user;
