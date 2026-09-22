import React from "react";

/**
 * Minimal, dependency-free markdown renderer — handles the subset emitted by
 * the deterministic fix-doc engine (headings, blockquotes, lists, code fences,
 * inline code, bold).
 */
export default function Markdown({ source }: { source: string }) {
  const lines = source.split("\n");
  const elements: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let codeBuffer: string[] = [];
  let inCode = false;

  const flushList = () => {
    if (listBuffer.length === 0) return;
    elements.push(
      <ol key={`list-${elements.length}`} className="list-decimal pl-5 my-2 space-y-1">
        {listBuffer.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ol>
    );
    listBuffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("```")) {
      if (inCode) {
        elements.push(
          <pre key={`code-${elements.length}`} className="bg-panel2 border border-border rounded-md p-3 my-2 overflow-x-auto text-xs">
            <code>{codeBuffer.join("\n")}</code>
          </pre>
        );
        codeBuffer = [];
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    if (line.startsWith("### ")) {
      flushList();
      elements.push(
        <h3 key={`h3-${elements.length}`} className="text-sm font-semibold mt-3 mb-1">
          {renderInline(line.slice(4))}
        </h3>
      );
    } else if (line.startsWith("## ")) {
      flushList();
      elements.push(
        <h3 key={`h2-${elements.length}`} className="text-sm font-semibold mt-3 mb-1">
          {renderInline(line.slice(3))}
        </h3>
      );
    } else if (line.startsWith("> ")) {
      flushList();
      elements.push(
        <blockquote key={`bq-${elements.length}`} className="border-l-2 border-note pl-3 text-muted my-2 text-xs uppercase tracking-wide font-semibold">
          {renderInline(line.slice(2))}
        </blockquote>
      );
    } else if (/^\d+\.\s/.test(line)) {
      listBuffer.push(line.replace(/^\d+\.\s/, ""));
    } else if (line.startsWith("- ")) {
      flushList();
      elements.push(
        <div key={`bullet-${elements.length}`} className="pl-5 my-0.5 text-sm">
          {renderInline(line.slice(2))}
        </div>
      );
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      elements.push(
        <p key={`p-${elements.length}`} className="my-1.5 text-sm">
          {renderInline(line)}
        </p>
      );
    }
  }
  flushList();
  if (inCode && codeBuffer.length) {
    elements.push(<pre key="code-final" className="bg-panel2 border border-border rounded-md p-3 overflow-x-auto text-xs"><code>{codeBuffer.join("\n")}</code></pre>);
  }

  return <div className="markdown">{elements}</div>;
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // **bold** and `code`
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(<code key={key++}>{token.slice(1, -1)}</code>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
