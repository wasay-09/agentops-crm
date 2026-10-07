/**
 * Clean model text before it reaches users or the CRM: strip leaked tool-call markup, internal tags
 * and raw function-call JSON that some models emit as text instead of a structured tool call.
 */
const BLOCK_PATTERNS: RegExp[] = [
  /<(thinking|reasoning|scratchpad)>[\s\S]*?<\/\1>/gi,
  /<(tool_call|tool_use|function_calls?|invoke)\b[^>]*>[\s\S]*?<\/\1>/gi,
  /<\/?(antml:[\w-]+|tool_call|tool_use|function_calls?|invoke|parameter|thinking|system)\b[^>]*>/gi,
  /```(?:json)?\s*\{\s*"(?:name|tool|function)"\s*:\s*"[^"]+"\s*,\s*"(?:arguments|args|input|parameters)"[\s\S]*?```/gi,
  /^\s*\{\s*"(?:name|tool)"\s*:\s*"[a-z_]+"\s*,\s*"(?:arguments|args|input|parameters)"\s*:[\s\S]*?\}\s*\}\s*$/gim,
];

export function sanitizeOutput(text: string): string {
  let out = text;
  for (const re of BLOCK_PATTERNS) out = out.replace(re, '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
