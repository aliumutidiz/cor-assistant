import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="message-body markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          // Do not fetch remote images embedded in model or calendar content.
          img: ({ alt }) => <span>{alt}</span>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
