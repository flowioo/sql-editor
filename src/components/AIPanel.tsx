import { useState, useRef, useCallback, useEffect } from "react";
import { useSettings } from "../hooks/useSettings";
import { useConfirm } from "../hooks/useConfirm";
import { classifyEndpoint, endpointHost } from "../lib/ai-endpoint";
import "../styles/ai-panel.css";

interface AIPanelProps {
  readonly schemaContext?: string;
  readonly connectionName?: string | null;
  readonly onInsertSQL?: (sql: string) => void;
}

interface Message {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export function AIPanel({ schemaContext, connectionName, onInsertSQL }: AIPanelProps) {
  const { settings, update } = useSettings();
  const { confirm, dialog } = useConfirm();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const trust = classifyEndpoint(settings.aiEndpoint);
  const isRemote = trust !== "local";
  const attachSchema = settings.aiSendSchema && !!schemaContext;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /**
   * Gate outbound requests to non-loopback endpoints behind an explicit,
   * per-host confirmation. Returns false when the user declines.
   *
   * Loopback endpoints skip the prompt entirely — nothing leaves the machine,
   * so there is nothing to consent to.
   */
  const approveOutbound = useCallback(async (): Promise<boolean> => {
    if (!isRemote) return true;
    if (settings.aiApprovedEndpoint === settings.aiEndpoint) return true;

    const host = endpointHost(settings.aiEndpoint);
    const ok = await confirm({
      title: `将数据发送到外部地址 ${host}？`,
      description: (
        <>
          该地址不在本机。本次及后续对话将向它发送：你输入的问题
          {attachSchema ? "、当前数据库结构（表名 / 列名 / 类型）与连接名称" : ""}。
          {trust === "invalid" && " 注意：该地址不是合法的 http(s) URL，请求可能失败。"}
          <br />
          确认后本机将记住对该地址的授权；更换地址会重新询问。
        </>
      ),
      confirmLabel: "确认发送",
      variant: "danger",
    });
    if (ok) update("aiApprovedEndpoint", settings.aiEndpoint);
    return ok;
  }, [
    isRemote,
    trust,
    attachSchema,
    settings.aiEndpoint,
    settings.aiApprovedEndpoint,
    confirm,
    update,
  ]);

  const send = useCallback(async () => {
    if (!input.trim() || loading) return;
    if (!(await approveOutbound())) return;

    const userMsg: Message = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      // Schema is attached only when the user opted in — see Settings.aiSendSchema.
      const systemPrompt = attachSchema
        ? `你是一个 SQL 专家助手。用户正在使用一个 SQL 编辑器连接到 ${connectionName ?? "数据库"}。
当前数据库结构：
${schemaContext}

请用中文回答。如果用户要求写 SQL，直接给出可执行的 SQL 语句，用 \`\`\`sql 代码块包裹。`
        : `你是一个 SQL 专家助手。用户正在使用一个 SQL 编辑器。你没有数据库结构信息，
若问题依赖具体表名 / 列名，请说明需要用户提供或开启「附带数据库结构」。

请用中文回答。如果用户要求写 SQL，直接给出可执行的 SQL 语句，用 \`\`\`sql 代码块包裹。`;

      const resp = await fetch(settings.aiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "default",
          messages: [
            { role: "system", content: systemPrompt },
            ...newMessages.map((m) => ({ role: m.role, content: m.content })),
          ],
          stream: false,
        }),
      });

      if (!resp.ok) throw new Error(`API 错误: ${resp.status}`);
      const data = await resp.json();
      const assistantContent = data.choices?.[0]?.message?.content ?? "（无响应）";

      setMessages([...newMessages, { role: "assistant", content: assistantContent }]);
    } catch (e) {
      setMessages([...newMessages, { role: "assistant", content: `错误: ${String(e)}` }]);
    } finally {
      setLoading(false);
    }
  }, [
    input,
    loading,
    messages,
    attachSchema,
    schemaContext,
    connectionName,
    settings.aiEndpoint,
    approveOutbound,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  return (
    <div className="ai-panel">
      <div className="ai-header">
        <span className="ai-title">AI 助手</span>
        <span className="ai-subtitle">Enter 发送，Shift+Enter 换行</span>
      </div>
      <div className="ai-privacy-bar">
        <label className="ai-privacy-toggle" title="关闭时不发送任何表名 / 列名">
          <input
            type="checkbox"
            checked={settings.aiSendSchema}
            onChange={(e) => update("aiSendSchema", e.target.checked)}
          />
          附带数据库结构
        </label>
        <span
          className={`ai-endpoint-badge ${isRemote ? "remote" : "local"}`}
          title={settings.aiEndpoint}
        >
          {isRemote ? `外部 · ${endpointHost(settings.aiEndpoint)}` : "本机"}
        </span>
      </div>
      <div className="ai-messages">
        {messages.length === 0 && (
          <div className="ai-empty">
            输入问题，如：帮我写一个查询用户表的 SQL
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`ai-message ${msg.role}`}>
            <div className="ai-message-content">
              {msg.content.split("```").map((part, j) => {
                if (j % 2 === 1) {
                  const sqlContent = part.replace(/^sql\s*\n?/, "").trim();
                  return (
                    <div key={j} className="ai-code-block">
                      <pre>{sqlContent}</pre>
                      {onInsertSQL && (
                        <button
                          className="ai-insert-btn"
                          onClick={() => onInsertSQL(sqlContent)}
                        >
                          插入编辑器
                        </button>
                      )}
                    </div>
                  );
                }
                return <span key={j}>{part}</span>;
              })}
            </div>
          </div>
        ))}
        {loading && <div className="ai-loading">思考中...</div>}
        <div ref={messagesEndRef} />
      </div>
      <div className="ai-input-area">
        <textarea
          className="ai-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入问题..."
          rows={2}
          disabled={loading}
        />
        <button
          className="ai-send-btn"
          onClick={send}
          disabled={loading || !input.trim()}
        >
          {loading ? "..." : "发送"}
        </button>
      </div>
      {dialog}
    </div>
  );
}
