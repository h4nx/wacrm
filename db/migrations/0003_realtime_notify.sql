-- ============================================================
-- wacrm — Realtime portable via LISTEN/NOTIFY
-- Payload mínimo (ids + alcance); el broker SSE del servidor
-- rehidrata la fila y la reparte a los suscriptores autorizados.
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_change() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
  AS $$
DECLARE
  v_row jsonb;
  v_account_id uuid;
BEGIN
  v_row := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);

  IF TG_TABLE_NAME = 'messages' THEN
    SELECT account_id INTO v_account_id
    FROM conversations WHERE id = (v_row ->> 'conversation_id')::uuid;
  ELSE
    v_account_id := (v_row ->> 'account_id')::uuid;
  END IF;

  PERFORM pg_notify('wacrm_changes', json_build_object(
    'table', TG_TABLE_NAME,
    'op', TG_OP,
    'id', COALESCE(v_row ->> 'id', v_row ->> 'user_id'),
    'account_id', v_account_id,
    'user_id', v_row ->> 'user_id'
  )::text);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS notify_change ON public.messages;
CREATE TRIGGER notify_change AFTER INSERT OR UPDATE OR DELETE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_change();

DROP TRIGGER IF EXISTS notify_change ON public.conversations;
CREATE TRIGGER notify_change AFTER INSERT OR UPDATE OR DELETE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.notify_change();

DROP TRIGGER IF EXISTS notify_change ON public.notifications;
CREATE TRIGGER notify_change AFTER INSERT OR UPDATE OR DELETE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notify_change();

DROP TRIGGER IF EXISTS notify_change ON public.member_presence;
CREATE TRIGGER notify_change AFTER INSERT OR UPDATE OR DELETE ON public.member_presence
  FOR EACH ROW EXECUTE FUNCTION public.notify_change();
