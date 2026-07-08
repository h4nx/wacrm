/**
 * Test de integración del productor de eventos del ecosistema contra
 * un Kafka real:
 *
 *   TEST_KAFKA_BROKERS=localhost:59092 npm test
 *
 * Sin TEST_KAFKA_BROKERS la suite se omite.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BROKERS = process.env.TEST_KAFKA_BROKERS;

describe.skipIf(!BROKERS)('eventos del ecosistema (Kafka real)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let consumer: any;
  const received: { topic: string; key: string; value: string }[] = [];
  const suffix = Date.now();
  const prefix = `wacrm-test-${suffix}`;

  beforeAll(async () => {
    process.env.KAFKA_BROKERS = BROKERS;
    process.env.KAFKA_TOPIC_PREFIX = prefix;

    const { Kafka, logLevel } = await import('kafkajs');
    const kafka = new Kafka({
      clientId: 'wacrm-test-consumer',
      brokers: BROKERS!.split(','),
      logLevel: logLevel.NOTHING,
    });
    // Crear el topic ANTES de suscribirse, para no depender del timing
    // del auto-create al publicar.
    const admin = kafka.admin();
    await admin.connect();
    await admin.createTopics({
      topics: [{ topic: `${prefix}.message.received`, numPartitions: 1 }],
    });
    await admin.disconnect();

    consumer = kafka.consumer({ groupId: `wacrm-test-${suffix}` });
    await consumer.connect();
    await consumer.subscribe({
      topic: `${prefix}.message.received`,
      fromBeginning: true,
    });
    await consumer.run({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eachMessage: async ({ topic, message }: any) => {
        received.push({
          topic,
          key: message.key?.toString() ?? '',
          value: message.value?.toString() ?? '',
        });
      },
    });
  }, 30_000);

  afterAll(async () => {
    await consumer?.disconnect();
  });

  it('publica wacrm.<evento> con clave account_id y sobre estándar', async () => {
    const { publishEcosystemEvent } = await import('./kafka');
    const ok = await publishEcosystemEvent('message.received', 'acc-123', {
      conversation_id: 'conv-1',
      text: 'hola',
    });
    expect(ok).toBe(true);

    // Espera a que el consumidor lo procese.
    const deadline = Date.now() + 15_000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(received.length).toBeGreaterThan(0);

    const msg = received[0];
    expect(msg.topic).toBe(`${prefix}.message.received`);
    expect(msg.key).toBe('acc-123');
    const envelope = JSON.parse(msg.value);
    expect(envelope.event).toBe('message.received');
    expect(envelope.account_id).toBe('acc-123');
    expect(envelope.data.text).toBe('hola');
    expect(new Date(envelope.occurred_at).getTime()).toBeGreaterThan(0);
  }, 30_000);

  it('sin KAFKA_BROKERS es un no-op que devuelve false', async () => {
    const saved = process.env.KAFKA_BROKERS;
    delete process.env.KAFKA_BROKERS;
    const { publishEcosystemEvent } = await import('./kafka');
    expect(await publishEcosystemEvent('message.received', 'acc', {})).toBe(
      false
    );
    process.env.KAFKA_BROKERS = saved;
  });
});
