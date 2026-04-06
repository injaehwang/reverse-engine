use anyhow::Result;
use reverseng_core::types::mapper::{GraphEdge, GraphNode, RelationGraph};
use rusqlite::Connection;

const SCHEMA: &str = include_str!("schema.sql");

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn open(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    pub fn save_graph(&self, graph: &RelationGraph) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;

        for node in &graph.nodes {
            tx.execute(
                "INSERT OR REPLACE INTO nodes (id, node_type, label, file_path, url, metadata)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    node.id,
                    serde_json::to_string(&node.node_type)?,
                    node.label,
                    node.file_path,
                    node.url,
                    serde_json::to_string(&node.metadata)?,
                ],
            )?;
        }

        for edge in &graph.edges {
            tx.execute(
                "INSERT INTO edges (from_id, to_id, edge_type, label, metadata)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    edge.from_id,
                    edge.to_id,
                    serde_json::to_string(&edge.edge_type)?,
                    edge.label,
                    edge.metadata.as_ref().map(|m| serde_json::to_string(m).unwrap_or_default()),
                ],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    pub fn load_graph(&self) -> Result<RelationGraph> {
        let mut nodes = vec![];
        let mut stmt = self.conn.prepare(
            "SELECT id, node_type, label, file_path, url, metadata FROM nodes",
        )?;

        let node_rows = stmt.query_map([], |row| {
            Ok(GraphNode {
                id: row.get(0)?,
                node_type: serde_json::from_str(&row.get::<_, String>(1)?).unwrap(),
                label: row.get(2)?,
                file_path: row.get(3)?,
                url: row.get(4)?,
                metadata: serde_json::from_str(&row.get::<_, String>(5)?).unwrap(),
            })
        })?;

        for node in node_rows {
            nodes.push(node?);
        }

        let mut edges = vec![];
        let mut stmt = self.conn.prepare(
            "SELECT from_id, to_id, edge_type, label, metadata FROM edges",
        )?;

        let edge_rows = stmt.query_map([], |row| {
            Ok(GraphEdge {
                from_id: row.get(0)?,
                to_id: row.get(1)?,
                edge_type: serde_json::from_str(&row.get::<_, String>(2)?).unwrap(),
                label: row.get(3)?,
                metadata: row.get::<_, Option<String>>(4)?
                    .map(|s| serde_json::from_str(&s).unwrap()),
            })
        })?;

        for edge in edge_rows {
            edges.push(edge?);
        }

        Ok(RelationGraph { nodes, edges })
    }
}
