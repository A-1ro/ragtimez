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

interface DirectiveChild {
  type: string;
  data?: { directiveLabel?: boolean };
  children?: TextNode[];
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
          author = child.children.map((c) => c.value).join("");
        } else {
          bodyChildren.push(child);
        }
      }

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
        const authorNode = {
          type: "paragraph" as const,
          children: [{ type: "text" as const, value: `— ${author}` }],
          data: {
            hName: "div",
            hProperties: { class: "admin-note-author" },
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
