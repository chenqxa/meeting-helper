'use client';

import React, { useMemo } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';

interface MindMapNode {
  id: string;
  label: string;
  type: 'root' | 'topic' | 'decision' | 'risk' | 'action' | 'next_step';
  description?: string;
  assignee?: string;
  priority?: 'high' | 'medium' | 'low';
}

interface MindMapEdge {
  source: string;
  target: string;
  label?: string;
}

interface MeetingMindMapProps {
  title: string;
  topics: Array<{ topic: string; description: string }>;
  decisions: Array<{ decision: string; rationale?: string; stakeholders?: string[] }>;
  risks: Array<{ risk: string; mitigation?: string }>;
  actionItems: Array<{ description: string; assignee?: string; priority?: string }>;
  nextSteps: Array<{ step: string; owner?: string }>;
  onNodeClick?: (node: MindMapNode) => void;
}

const nodeColors: Record<string, string> = {
  root: '#3b82f6',
  topic: '#10b981',
  decision: '#8b5cf6',
  risk: '#ef4444',
  action: '#f59e0b',
  next_step: '#06b6d4',
};

export function MeetingMindMap({
  title,
  topics,
  decisions,
  risks,
  actionItems,
  nextSteps,
  onNodeClick,
}: MeetingMindMapProps) {
  const initialNodes = useMemo<Node[]>(() => {
    const nodes: Node[] = [];
    let yOffset = 0;
    const xSpacing = 300;
    const ySpacing = 100;

    // Root node
    nodes.push({
      id: 'root',
      type: 'default',
      position: { x: 0, y: 0 },
      data: {
        label: title,
        type: 'root',
      },
      style: {
        background: nodeColors.root,
        color: 'white',
        border: 'none',
        borderRadius: '12px',
        padding: '16px 24px',
        fontSize: '16px',
        fontWeight: 'bold',
        boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
      },
    });

    // Topics
    topics.forEach((topic, i) => {
      const id = `topic-${i}`;
      nodes.push({
        id,
        type: 'default',
        position: { x: xSpacing, y: yOffset },
        data: {
          label: topic.topic,
          description: topic.description,
          type: 'topic',
        },
        style: {
          background: nodeColors.topic,
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          padding: '12px 16px',
          fontSize: '14px',
          maxWidth: '250px',
        },
      });
      yOffset += ySpacing;
    });

    // Decisions
    decisions.forEach((decision, i) => {
      const id = `decision-${i}`;
      nodes.push({
        id,
        type: 'default',
        position: { x: xSpacing, y: yOffset },
        data: {
          label: decision.decision.substring(0, 50) + (decision.decision.length > 50 ? '...' : ''),
          description: decision.rationale,
          type: 'decision',
        },
        style: {
          background: nodeColors.decision,
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          padding: '12px 16px',
          fontSize: '14px',
          maxWidth: '250px',
        },
      });
      yOffset += ySpacing;
    });

    // Risks
    risks.forEach((risk, i) => {
      const id = `risk-${i}`;
      nodes.push({
        id,
        type: 'default',
        position: { x: xSpacing, y: yOffset },
        data: {
          label: risk.risk.substring(0, 50) + (risk.risk.length > 50 ? '...' : ''),
          description: risk.mitigation,
          type: 'risk',
        },
        style: {
          background: nodeColors.risk,
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          padding: '12px 16px',
          fontSize: '14px',
          maxWidth: '250px',
        },
      });
      yOffset += ySpacing;
    });

    // Action Items
    actionItems.forEach((item, i) => {
      const id = `action-${i}`;
      nodes.push({
        id,
        type: 'default',
        position: { x: xSpacing * 2, y: i * ySpacing },
        data: {
          label: item.description.substring(0, 40) + (item.description.length > 40 ? '...' : ''),
          assignee: item.assignee,
          priority: item.priority,
          type: 'action',
        },
        style: {
          background: nodeColors.action,
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          padding: '10px 14px',
          fontSize: '13px',
          maxWidth: '200px',
        },
      });
    });

    // Next Steps
    nextSteps.forEach((step, i) => {
      const id = `next-${i}`;
      nodes.push({
        id,
        type: 'default',
        position: { x: xSpacing * 2, y: (actionItems.length + i) * ySpacing + 50 },
        data: {
          label: step.step.substring(0, 40) + (step.step.length > 40 ? '...' : ''),
          owner: step.owner,
          type: 'next_step',
        },
        style: {
          background: nodeColors.next_step,
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          padding: '10px 14px',
          fontSize: '13px',
          maxWidth: '200px',
        },
      });
    });

    return nodes;
  }, [title, topics, decisions, risks, actionItems, nextSteps]);

  const initialEdges = useMemo<Edge[]>(() => {
    const edges: Edge[] = [];

    // Connect topics to root
    topics.forEach((_, i) => {
      edges.push({
        id: `e-topic-${i}`,
        source: 'root',
        target: `topic-${i}`,
        animated: true,
        style: { stroke: nodeColors.topic, strokeWidth: 2 },
      });
    });

    // Connect decisions to root
    decisions.forEach((_, i) => {
      edges.push({
        id: `e-decision-${i}`,
        source: 'root',
        target: `decision-${i}`,
        animated: true,
        style: { stroke: nodeColors.decision, strokeWidth: 2 },
      });
    });

    // Connect risks to root
    risks.forEach((_, i) => {
      edges.push({
        id: `e-risk-${i}`,
        source: 'root',
        target: `risk-${i}`,
        animated: true,
        style: { stroke: nodeColors.risk, strokeWidth: 2 },
      });
    });

    // Connect action items to related nodes
    actionItems.forEach((_, i) => {
      edges.push({
        id: `e-action-${i}`,
        source: 'root',
        target: `action-${i}`,
        style: { stroke: nodeColors.action, strokeWidth: 2 },
      });
    });

    // Connect next steps to root
    nextSteps.forEach((_, i) => {
      edges.push({
        id: `e-next-${i}`,
        source: 'root',
        target: `next-${i}`,
        style: { stroke: nodeColors.next_step, strokeWidth: 2 },
      });
    });

    return edges;
  }, [topics, decisions, risks, actionItems, nextSteps]);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const handleNodeClick = (_: React.MouseEvent, node: Node) => {
    if (onNodeClick) {
      onNodeClick(node.data as MindMapNode);
    }
  };

  return (
    <div className="w-full h-[600px] border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        fitView
        attributionPosition="bottom-right"
      >
        <Background color="#94a3b8" gap={16} size={1} />
        <Controls className="bg-white shadow-lg border border-slate-200" />
        <MiniMap
          nodeStrokeColor={(n) => nodeColors[n.data?.type as string] || '#94a3b8'}
          nodeColor={(n) => nodeColors[n.data?.type as string] || '#94a3b8'}
          className="bg-white shadow-lg border border-slate-200 rounded-lg"
        />
        <Panel position="top-left" className="bg-white/90 backdrop-blur-sm p-3 rounded-lg shadow-lg border border-slate-200">
          <h4 className="text-sm font-semibold text-slate-700 mb-2">图例</h4>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: nodeColors.root }}></span>会议主题</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: nodeColors.topic }}></span>关键议题</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: nodeColors.decision }}></span>决策</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: nodeColors.risk }}></span>风险</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: nodeColors.action }}></span>行动项</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: nodeColors.next_step }}></span>下一步</div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
