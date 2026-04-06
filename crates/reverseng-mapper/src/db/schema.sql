CREATE TABLE IF NOT EXISTS nodes (
    id          TEXT PRIMARY KEY,
    node_type   TEXT NOT NULL,
    label       TEXT NOT NULL,
    file_path   TEXT,
    url         TEXT,
    metadata    TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS edges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id     TEXT NOT NULL,
    to_id       TEXT NOT NULL,
    edge_type   TEXT NOT NULL,
    label       TEXT,
    metadata    TEXT,
    FOREIGN KEY (from_id) REFERENCES nodes(id),
    FOREIGN KEY (to_id)   REFERENCES nodes(id)
);

CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to   ON edges(to_id);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(edge_type);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(node_type);
