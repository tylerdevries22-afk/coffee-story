/**
 * A stand-in for the Responses API: `globalThis.fetch` answers from a script
 * and records every request, so no test reaches the provider or holds a key.
 */
export type SentRequest = {
  readonly url: string;
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
};

export type StubReply = { readonly status?: number; readonly payload: unknown };

/** A completed response whose one output is `value` as JSON text. */
export function outputText(value: unknown): unknown {
  return { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] };
}

export function stubResponses(
  answer: (body: Record<string, unknown>, index: number) => StubReply,
): { readonly sent: SentRequest[]; restore(): void } {
  const original = globalThis.fetch;
  const sent: SentRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    sent.push({ url: String(input), headers: new Headers(init?.headers), body });
    const reply = answer(body, sent.length - 1);
    return new Response(JSON.stringify(reply.payload), { status: reply.status ?? 200 });
  }) as typeof fetch;
  return {
    sent,
    restore() {
      globalThis.fetch = original;
    },
  };
}

/** Whether a request body is the site-extraction pass rather than hosted search. */
export function isExtraction(body: Record<string, unknown>): boolean {
  const format = (body.text as { format?: { name?: unknown } } | undefined)?.format;
  return format?.name === 'platform_site_brand_kit';
}
