/**
 * OTP codes out of the stack's Mailpit: the tests sign in exactly the way a
 * guest does — request a code, read the email, type it in — rather than
 * minting sessions through a back door.
 */
import { stack } from './stack.ts';

type SearchResult = { messages?: { ID: string }[] };
type Message = { Text?: string; HTML?: string };

export async function latestOtpFor(email: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const search = await fetch(
      `${stack.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=1`,
    );
    if (search.ok) {
      const found = (await search.json()) as SearchResult;
      const id = found.messages?.[0]?.ID;
      if (id) {
        const message = await fetch(`${stack.mailpitUrl}/api/v1/message/${id}`);
        if (message.ok) {
          const body = (await message.json()) as Message;
          const code = /\b(\d{6})\b/.exec(`${body.Text ?? ''} ${body.HTML ?? ''}`)?.[1];
          if (code) return code;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`No OTP email for ${email} within ${timeoutMs}ms`);
}
