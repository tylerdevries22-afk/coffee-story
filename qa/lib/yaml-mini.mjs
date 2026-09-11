// Minimal YAML reader for the durable task files in qa/: block mappings, block
// sequences, plain scalars and folded/literal scalars. It is deliberately not a
// general parser — anchors, flow collections and multi-document streams are out
// of scope, so a file that uses them fails loudly here rather than silently
// parsing to the wrong shape.
const KEY = /^([\w.-]+):(?:\s+([\s\S]*))?$/;

function scan(text) {
  const lines = [];
  for (const raw of text.split("\n")) {
    const trimmedEnd = raw.replace(/\s+$/, "");
    const body = trimmedEnd.trimStart();
    if (!body || body.startsWith("#")) continue;
    const indent = trimmedEnd.length - body.length;
    if (body === "-" || body.startsWith("- ")) {
      lines.push({ indent, text: body.slice(1).trim(), dash: true });
      continue;
    }
    lines.push({ indent, text: body, dash: false });
  }
  return lines;
}

function unquote(value) {
  const text = value.trim();
  if (text.length > 1 && (text.startsWith('"') || text.startsWith("'"))) {
    const quote = text[0];
    if (text.endsWith(quote)) return text.slice(1, -1);
  }
  return text;
}

function block(lines, cur, indent, style) {
  const parts = [];
  while (cur.i < lines.length && lines[cur.i].indent > indent) {
    parts.push(lines[cur.i].dash ? `- ${lines[cur.i].text}` : lines[cur.i].text);
    cur.i += 1;
  }
  return style === ">" ? parts.join(" ") : parts.join("\n");
}

function sequence(lines, cur, indent) {
  const out = [];
  while (cur.i < lines.length && lines[cur.i].indent === indent && lines[cur.i].dash) {
    const line = lines[cur.i];
    if (!line.text) {
      cur.i += 1;
      out.push(node(lines, cur, lines[cur.i].indent));
      continue;
    }
    // Re-present the dash line as an ordinary line two columns in, so a mapping
    // whose first key shares the dash line parses like any other mapping.
    lines[cur.i] = { indent: indent + 2, text: line.text, dash: false };
    out.push(node(lines, cur, indent + 2));
  }
  return out;
}

function mapping(lines, cur, indent) {
  const out = {};
  while (cur.i < lines.length && lines[cur.i].indent === indent && !lines[cur.i].dash) {
    const match = KEY.exec(lines[cur.i].text);
    if (!match) break;
    const [, key, rest] = match;
    cur.i += 1;
    if (rest === undefined) {
      out[key] = cur.i < lines.length && lines[cur.i].indent > indent
        ? node(lines, cur, lines[cur.i].indent)
        : "";
    } else if (rest === ">-" || rest === ">" || rest === "|" || rest === "|-") {
      out[key] = block(lines, cur, indent, rest[0]);
    } else {
      out[key] = unquote(rest);
    }
  }
  return out;
}

function node(lines, cur, indent) {
  const line = lines[cur.i];
  if (line.dash) return sequence(lines, cur, indent);
  if (!KEY.test(line.text)) {
    cur.i += 1;
    return unquote(line.text);
  }
  return mapping(lines, cur, indent);
}

export function parseYaml(text) {
  const lines = scan(text);
  if (!lines.length) return {};
  return node(lines, { i: 0 }, lines[0].indent);
}
