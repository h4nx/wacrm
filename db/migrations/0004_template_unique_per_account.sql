-- ============================================================
-- convix — Unicidad de plantillas por cuenta, no por autor
-- El índice único original era (user_id, name, language): dos
-- agentes de la MISMA cuenta podían crear una plantilla con el
-- mismo nombre/idioma sin chocar entre sí (y sin pisar la del otro),
-- que es justo lo contrario de lo que se necesita para el upsert
-- de re-envío a Meta. Meta ya trata el nombre+idioma como único por
-- WABA, así que el índice debe reflejar eso: único por cuenta.
-- ============================================================

DROP INDEX IF EXISTS public.message_templates_user_name_language_key;

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_account_name_language_key
  ON public.message_templates USING btree (account_id, name, language);
