import type { ReactNode } from "react";

/**
 * Lightweight formatter for assistant output — supports the subset that
 * matters in a chat: headings, bullets, numbered lists, fenced code blocks,
 * inline code, bold and italic. No markdown dependency; unknown syntax
 * renders as plain text.
 */

const INLINE_SPLIT = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  return text
    .split(INLINE_SPLIT)
    .filter((p) => p !== "")
    .map((part, i) => {
      const key = `${keyBase}.${i}`;
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
        return <strong key={key} className="font-semibold text-paper-900">{part.slice(2, -2)}</strong>;
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
        return (
          <code key={key} className="rounded bg-paper-100 px-1 py-px font-mono text-[12px] text-paper-800 ring-1 ring-inset ring-paper-900/[0.07]">
            {part.slice(1, -1)}
          </code>
        );
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2)
        return <em key={key}>{part.slice(1, -1)}</em>;
      return part;
    });
}

function renderMultiline(text: string, keyBase: string): ReactNode[] {
  // continuation lines inside a list item are joined with "\n" — break them
  return text.split("\n").map((line, i) =>
    i === 0 ? (
      renderInline(line, `${keyBase}.${i}`)
    ) : (
      <span key={`${keyBase}.${i}`}>
        <br />
        {renderInline(line, `${keyBase}.${i}`)}
      </span>
    ),
  );
}

/** Parses one fence-free stretch into blocks, always in source order. */
function TextBlocks({ source }: { source: string }) {
  const lines = source.split("\n");
  const nodes: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (!para.length) return;
    const key = `b${nodes.length}`;
    nodes.push(
      <p key={key} className="whitespace-pre-wrap text-sm leading-relaxed text-paper-900">
        {renderInline(para.join("\n"), key)}
      </p>,
    );
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const L = list;
    const key = `b${nodes.length}`;
    const items = L.items.map((it, i) => (
      <li key={i} className="text-sm leading-relaxed text-paper-900">
        {renderMultiline(it, `${key}.${i}`)}
      </li>
    ));
    nodes.push(
      L.ordered ? (
        <ol key={key} className="list-decimal space-y-1 pl-5 marker:font-medium marker:text-paper-400">
          {items}
        </ol>
      ) : (
        <ul key={key} className="list-disc space-y-1 pl-5 marker:text-paper-400">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  for (const raw of lines) {
    const heading = /^(#{1,4})\s+(.*)$/.exec(raw);
    const bullet = /^[-*]\s+(.*)$/.exec(raw);
    const ordered = /^\d+[.)]\s+(.*)$/.exec(raw);

    if (heading) {
      flushPara();
      flushList();
      nodes.push(
        <h3 key={`b${nodes.length}`} className="pt-1 font-serif text-[15px] font-semibold tracking-tight text-paper-900">
          {renderInline(heading[2]!, `b${nodes.length}`)}
        </h3>,
      );
    } else if (bullet || ordered) {
      flushPara();
      const isOrdered = !!ordered;
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push((ordered ?? bullet)![1]!);
    } else if (raw.trim() === "") {
      flushPara();
      flushList();
    } else if (list && !para.length && /^[ \t]/.test(raw)) {
      // indented line right after an item continues that item
      list.items[list.items.length - 1] += `\n${raw.trim()}`;
    } else {
      // plain prose after a list must not jump above it
      flushList();
      para.push(raw);
    }
  }
  flushPara();
  flushList();

  return <>{nodes}</>;
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const nodes: ReactNode[] = [];
  const fence = /```[\w-]*\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) {
    if (m.index > last) nodes.push(<TextBlocks key={`t${nodes.length}`} source={text.slice(last, m.index)} />);
    nodes.push(
      <pre
        key={`c${nodes.length}`}
        className="overflow-x-auto rounded-lg border border-paper-900/[0.09] bg-paper-50 p-3 font-mono text-[12px] leading-relaxed text-paper-700"
      >
        {m[1]?.replace(/\n$/, "")}
      </pre>,
    );
    last = fence.lastIndex;
  }
  if (last < text.length) nodes.push(<TextBlocks key={`t${nodes.length}`} source={text.slice(last)} />);
  return <div className={className}>{nodes}</div>;
}
