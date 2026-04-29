import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../lib/api";

const PROSE_CLASSES = [
  "prose prose-invert prose-sm max-w-none",
  "prose-p:my-2 prose-p:leading-relaxed",
  "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
  "prose-headings:text-zinc-100 prose-headings:font-medium",
  "prose-strong:text-zinc-100",
  "prose-em:text-zinc-200",
  "prose-a:text-sky-400 prose-a:no-underline hover:prose-a:underline",
  "prose-code:bg-zinc-900 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-zinc-200 prose-code:text-[0.85em] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none",
  "prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-pre:rounded-lg prose-pre:my-3",
  "prose-blockquote:border-l-zinc-700 prose-blockquote:text-zinc-400",
  "prose-hr:border-zinc-800",
].join(" ");

export function MessageBubble({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="max-w-[85%] rounded-2xl bg-zinc-900 px-4 py-2.5 text-zinc-100">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start animate-fade-in">
      <div className={`max-w-[85%] text-zinc-200 ${PROSE_CLASSES}`}>
        {message.content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        ) : (
          <span className="inline-block h-4 w-1.5 animate-pulse bg-zinc-500 align-middle" />
        )}
      </div>
    </div>
  );
}
