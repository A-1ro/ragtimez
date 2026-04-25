/**
 * Remark plugin that transforms `:::admin-note` container directives
 * into styled HTML blocks for admin annotations.
 *
 * Usage in Markdown:
 *
 *   :::admin-note
 *   注釈内容（著者名なし）
 *   :::
 *
 *   :::admin-note[山田太郎]
 *   注釈内容（末尾に "— 山田太郎" が表示される）
 *   :::
 *
 * Renders as:
 *   <aside class="admin-note" role="note">
 *     <div class="admin-note-header">管理人の注釈</div>
 *     <div class="admin-note-body"><p>...</p></div>
 *     <div class="admin-note-author">— 山田太郎</div>   ← optional
 *   </aside>
 */
import type { Root } from "mdast";
import { visit } from "unist-util-visit";

interface TextNode {
  type: "text";
  value: string;
}

interface LinkNode {
  type: "link";
  url: string;
  title: null;
  children: TextNode[];
}

interface DirectiveChild {
  type: string;
  data?: { directiveLabel?: boolean };
  children?: (TextNode | LinkNode | DirectiveChild)[];
}

// Split a text value by bare URLs and return a mixed array of text/link nodes.
const URL_RE = /(https?:\/\/[^\s\])['"<>]+)/g;

function splitTextByUrls(value: string): (TextNode | LinkNode)[] {
  const parts: (TextNode | LinkNode)[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(value)) !== null) {
    if (match.index > last) {
      parts.push({ type: "text", value: value.slice(last, match.index) });
    }
    parts.push({
      type: "link",
      url: match[1],
      title: null,
      children: [{ type: "text", value: match[1] }],
    });
    last = match.index + match[1].length;
  }
  if (last < value.length) {
    parts.push({ type: "text", value: value.slice(last) });
  }
  return parts.length > 0 ? parts : [{ type: "text", value }];
}

// Walk body children and convert bare URL text nodes to link nodes.
// This handles cases where remark-gfm does not autolink URLs inside
// container directive bodies.
function autolinkBodyUrls(nodes: unknown[]): void {
  for (const node of nodes) {
    const n = node as DirectiveChild;
    if (!n.children) continue;
    // Process inline children of paragraphs
    if (n.type === "paragraph") {
      const next: (TextNode | LinkNode | DirectiveChild)[] = [];
      for (const child of n.children) {
        if (child.type === "text" && "value" in child) {
          next.push(...splitTextByUrls((child as TextNode).value));
        } else {
          next.push(child);
        }
      }
      n.children = next;
    } else {
      autolinkBodyUrls(n.children as unknown[]);
    }
  }
}

interface DirectiveNode {
  type: string;
  name: string;
  children: DirectiveChild[];
  data?: {
    hName?: string;
    hProperties?: Record<string, string>;
  };
}

export function remarkAdminNote() {
  return (tree: Root) => {
    visit(tree, (node) => {
      const d = node as unknown as DirectiveNode;

      // Only handle :::admin-note (containerDirective)
      if (d.type !== "containerDirective" || d.name !== "admin-note") {
        return;
      }

      // Extract author name from the directive label (:::admin-note[著者名])
      // and separate body children from the label node.
      let author: string | null = null;
      const bodyChildren: unknown[] = [];

      for (const child of d.children) {
        if (child.data?.directiveLabel && child.children?.length) {
          author = child.children
            .filter((c): c is TextNode => c.type === "text")
            .map((c) => c.value)
            .join("");
        } else {
          bodyChildren.push(child);
        }
      }

      // Convert bare URLs in body text nodes to link nodes.
      autolinkBodyUrls(bodyChildren);

      // Wrap body children in a div
      const bodyNode = {
        type: "containerDirective" as const,
        name: "div",
        children: bodyChildren,
        data: {
          hName: "div",
          hProperties: { class: "admin-note-body" },
        },
      };

      // Header node
      const headerNode = {
        type: "paragraph" as const,
        children: [{ type: "text" as const, value: "管理人の注釈" }],
        data: {
          hName: "div",
          hProperties: { class: "admin-note-header" },
        },
      };

      // Build children: header + body + optional author footer
      const newChildren: unknown[] = [headerNode, bodyNode];

      if (author) {
        // Use hast children directly so the <a> tag survives remark-rehype
        // regardless of how the pipeline handles mdast link nodes inside
        // nodes with data.hName overrides.
        const authorNode = {
          type: "paragraph" as const,
          children: [] as unknown[],
          data: {
            hName: "div",
            hProperties: { class: "admin-note-author" },
            hChildren: [
              { type: "text" as const, value: "— " },
              {
                type: "element" as const,
                tagName: "a",
                properties: { href: `/profile/${author}` },
                children: [{ type: "text" as const, value: author }],
              },
            ],
          },
        };
        newChildren.push(authorNode);
      }

      // Replace the directive node itself with an <aside>
      d.data = {
        hName: "aside",
        hProperties: { class: "admin-note", role: "note" },
      };
      d.children = newChildren as DirectiveChild[];
    });
  };
}
