// Verhindert, dass OpenClaw bei leerer Agent-Antwort seinen internen
// Fallback-Text nach außen schickt (in DMs ist das per Konfig nicht
// abschaltbar, siehe buildEmptyInteractiveReplyPayload in OpenClaw 2026.9.4).
// Stattdessen wird nichts gesendet und nur geloggt.

const BLOCKED = [
  "did not produce a visible reply",
];

function matches(text) {
  if (typeof text !== "string" || !text) return false;
  const norm = text.replace(/\s+/g, " ").toLowerCase();
  return BLOCKED.some((needle) => norm.includes(needle));
}

export default {
  id: "v3d-no-fallback-text",
  name: "V3D: keine internen Fallback-Texte",
  description: "Verwirft interne Fallback-Texte bei leerer Agent-Antwort.",
  register(api) {
    const log = (where, target, text) =>
      api.logger?.warn?.(
        `[v3d-no-fallback-text] ${where}: Fallback-Text an ${target ?? "?"} verworfen: ${JSON.stringify(text.slice(0, 120))}`,
      );

    api.on("reply_payload_sending", (event, ctx) => {
      const text = event?.payload?.text;
      if (!matches(text)) return;
      log("reply_payload_sending", ctx?.conversationId ?? event?.sessionKey, text);
      return { cancel: true, reason: "v3d-no-fallback-text" };
    });

    api.on("message_sending", (event, ctx) => {
      const text = event?.content;
      if (!matches(text)) return;
      log("message_sending", event?.to ?? ctx?.conversationId, text);
      return { cancel: true, cancelReason: "v3d-no-fallback-text" };
    });
  },
};
