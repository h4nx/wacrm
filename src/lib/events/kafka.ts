/**
 * Productor de eventos del ecosistema H&M Business (fase 2).
 *
 * Cada evento de dominio de wacrm se publica en Kafka con la
 * convención de topics del ecosistema (`<producto>.<evento>`, como
 * `orbix.invoice.emitted`):
 *
 *   wacrm.message.received
 *   wacrm.message.status_updated
 *   wacrm.conversation.created
 *
 * Se activa definiendo KAFKA_BROKERS (lista separada por comas). Sin
 * esa variable es un no-op — wacrm sigue siendo autocontenido. La
 * publicación es best-effort y NUNCA lanza: se dispara desde el
 * webhook entrante, donde un broker caído no puede afectar el 200 a
 * Meta. La clave del mensaje es el account_id (ordena por cuenta).
 */
import type { Kafka, Producer } from 'kafkajs';

export function kafkaEnabled(): boolean {
  return Boolean(process.env.KAFKA_BROKERS);
}

function topicPrefix(): string {
  return process.env.KAFKA_TOPIC_PREFIX ?? 'wacrm';
}

let producerPromise: Promise<Producer> | null = null;

async function getProducer(): Promise<Producer> {
  if (!producerPromise) {
    producerPromise = (async () => {
      const { Kafka: KafkaCtor, logLevel } = await import('kafkajs');
      const kafka: Kafka = new KafkaCtor({
        clientId: process.env.KAFKA_CLIENT_ID ?? 'wacrm',
        brokers: process.env.KAFKA_BROKERS!.split(',').map((b) => b.trim()),
        logLevel: logLevel.ERROR,
        retry: { retries: 3 },
      });
      const producer = kafka.producer({ allowAutoTopicCreation: true });
      await producer.connect();
      return producer;
    })();
    // Un fallo de conexión no debe envenenar los intentos siguientes.
    producerPromise.catch(() => {
      producerPromise = null;
    });
  }
  return producerPromise;
}

export interface EcosystemEvent {
  event: string;
  account_id: string;
  occurred_at: string;
  data: unknown;
}

/**
 * Publica `wacrm.<event>` en el bus del ecosistema. Best-effort:
 * loguea y sigue ante cualquier error. Devuelve true si se publicó.
 */
export async function publishEcosystemEvent(
  event: string,
  accountId: string,
  data: unknown
): Promise<boolean> {
  if (!kafkaEnabled()) return false;
  try {
    const producer = await getProducer();
    const envelope: EcosystemEvent = {
      event,
      account_id: accountId,
      occurred_at: new Date().toISOString(),
      data,
    };
    await producer.send({
      topic: `${topicPrefix()}.${event}`,
      messages: [{ key: accountId, value: JSON.stringify(envelope) }],
    });
    return true;
  } catch (err) {
    console.error('[events] fallo publicando en Kafka (se ignora):', err);
    return false;
  }
}
