'use client';

import React, { useCallback, useMemo } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';

interface MindMapProps {
  summary?: {
    topics?: string[];
    keyDecisions?: string[];
    risks?: string[];
    nextSteps?: string[];
  };
}

interface MeetingSummary {
  topics?: string[];
  keyDecisions?: string[];
  risks?: string[];
  nextSteps?: string[];
}

export default function MindMap({ summary }: MindMapProps) {
  // 基于摘要数据生成节点和边
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    if (!summary) {
      return { nodes, edges };
    }

    // 根节点
    nodes.push({
      id: 'root',
      type: 'input',
      data: { label: '会议核心要点' },
      position: { x: 0, y: 0 },
      style: {
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: '#fff',
        padding: '12px 24px',
        borderRadius: '12px',
        fontSize: '16px',
        fontWeight: 'bold',
        border: 'none',
        width: '180px',
        textAlign: 'center',
      },
    });

    const summaryData = summary as MeetingSummary;

    // 一级节点配置
    const categories = [
      {
        id: 'topics',
        label: '核心议题',
        items: summaryData.topics || [],
        color: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        position: { x: -300, y: -200 },
      },
      {
        id: 'decisions',
        label: '关键决策',
        items: summaryData.keyDecisions || [],
        color: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        position: { x: 300, y: -200 },
      },
      {
        id: 'risks',
        label: '风险提醒',
        items: summaryData.risks || [],
        color: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
        position: { x: -300, y: 200 },
      },
      {
        id: 'nextSteps',
        label: '下一步建议',
        items: summaryData.nextSteps || [],
        color: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
        position: { x: 300, y: 200 },
      },
    ];

    // 创建一级节点和二级节点
    categories.forEach((category) => {
      // 一级节点
      nodes.push({
        id: category.id,
        data: { label: `${category.label} (${category.items.length})` },
        position: category.position,
        style: {
          background: category.color,
          color: '#fff',
          padding: '10px 20px',
          borderRadius: '10px',
          fontSize: '14px',
          fontWeight: '600',
          border: 'none',
          width: '160px',
          textAlign: 'center',
        },
      });

      // 边：根节点 -> 一级节点
      edges.push({
        id: `root-${category.id}`,
        source: 'root',
        target: category.id,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#cbd5e1', strokeWidth: 2 },
      });

      // 二级节点
      category.items.forEach((item, index) => {
        const itemId = `${category.id}-item-${index}`;
        const verticalSpacing = 100;
        const itemY = category.position.y + (index - (category.items.length - 1) / 2) * verticalSpacing;

        nodes.push({
          id: itemId,
          data: { label: item.substring(0, 30) + (item.length > 30 ? '...' : '') },
          position: {
            x: category.position.x + (category.position.x > 0 ? 220 : -220),
            y: itemY,
          },
          style: {
            background: '#fff',
            border: '2px solid #e2e8f0',
            padding: '8px 12px',
            borderRadius: '8px',
            fontSize: '12px',
            width: '140px',
            textAlign: 'center',
          },
        });

        // 边：一级节点 -> 二级节点
        edges.push({
          id: `${category.id}-${itemId}`,
          source: category.id,
          target: itemId,
          type: 'smoothstep',
          style: { stroke: '#e2e8f0', strokeWidth: 1.5 },
        });
      });
    });

    return { nodes, edges };
  }, [summary]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div className="w-full h-[600px] bg-slate-50 rounded-xl border border-slate-200">
      {initialNodes.length > 0 ? (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          defaultEdgeOptions={{
            type: 'smoothstep',
            animated: true,
          }}
        >
          <Background
            color="#cbd5e1"
            gap={16}
            size={1}
          />
          <Controls />
          <MiniMap
            nodeColor={(node) => {
              if (node.id === 'root') return '#667eea';
              return '#f093fb';
            }}
            nodeStrokeWidth={3}
            zoomable
            pannable
          />
        </ReactFlow>
      ) : (
        <div className="flex items-center justify-center h-full text-slate-400">
          <div className="text-center">
            <p>暂无思维导图数据</p>
            <p className="text-sm mt-2">请先生成会议纪要</p>
          </div>
        </div>
      )}
    </div>
  );
}
