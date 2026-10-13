import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownMessage({ text }: { text: string }) {
  return <div className="message-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml
    urlTransform={defaultUrlTransform}
    components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>
    {text}
  </ReactMarkdown></div>;
}
