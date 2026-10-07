/** `children === null` marks a file. */
export type TreeNode = { name: string; rel: string; children: TreeNode[] | null };

export function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const path of paths) {
    const parts = path.split("/");
    let level = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      let node = level.find((n) => n.name === part && (n.children === null) === isFile);
      if (!node) {
        node = { name: part, rel: parts.slice(0, i + 1).join("/"), children: isFile ? null : [] };
        level.push(node);
      }
      if (node.children) level = node.children;
    });
  }
  sortTree(root);
  return root;
}

function sortTree(nodes: TreeNode[]) {
  nodes.sort((a, b) => Number(a.children === null) - Number(b.children === null) || a.name.localeCompare(b.name));
  for (const n of nodes) if (n.children) sortTree(n.children);
}
