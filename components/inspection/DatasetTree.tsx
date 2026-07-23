import type { DatasetNode } from "@/types/netcdf";

export default function DatasetTree({ node }: { node: DatasetNode }) {
  return (
    <details open={node.path === "/"}>
      <summary>
        <span className={node.kind === "group" ? "folder" : "dataset"}>{node.kind === "group" ? "GROUP" : "DATASET"}</span>
        {node.name} {node.shape?.length ? <code>[{node.shape.join(" × ")}] · {node.dtype}</code> : null}
      </summary>
      {node.children?.length ? <div className="tree">{node.children.map((child) => <DatasetTree key={child.path} node={child} />)}</div> : null}
    </details>
  );
}
