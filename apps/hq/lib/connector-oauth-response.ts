export async function cancelConnectorResponse(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* preserve the lifecycle result */ }
}

/** Read and release a response stream without permitting an unbounded body. */
export async function readBoundedConnectorResponse(
  response: Response,
  maxBytes: number,
  failure: () => Error,
): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await cancelConnectorResponse(response);
    throw failure();
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) return text + decoder.decode();
      bytes += part.value.byteLength;
      if (bytes > maxBytes) {
        try { await reader.cancel(); } catch { /* preserve the size failure */ }
        throw failure();
      }
      text += decoder.decode(part.value, { stream: true });
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* preserve the read failure */ }
    throw error;
  } finally {
    reader.releaseLock();
  }
}
