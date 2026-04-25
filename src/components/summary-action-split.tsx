'use client';

import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, AlertCircle, Link2 } from 'lucide-react';

interface ActionItem {
  id: string;
  description: string;
  assignee?: string | null;
  due_date?: string | null;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'confirmed' | 'in_progress' | 'done' | 'blocked';
  confidence_owner: number;
  confidence_date: number;
  source_sentence?: string;
}

interface SummarySection {
  section_type: 'agenda' | 'conclusion' | 'risk' | 'decision' | 'next_step';
  content: string;
  confidence: number;
  relatedActions?: string[]; // ActionItem IDs
}

interface SummaryActionSplitProps {
  summary: SummarySection[];
  actionItems: ActionItem[];
  onActionClick?: (actionId: string) => void;
  onLinkAction?: (sectionIndex: number, actionId: string) => void;
}

const SECTION_COLORS: Record<string, string> = {
  agenda: 'border-l-4 border-l-blue-500 bg-blue-50/50',
  decision: 'border-l-4 border-l-purple-500 bg-purple-50/50',
  risk: 'border-l-4 border-l-red-500 bg-red-50/50',
  next_step: 'border-l-4 border-l-amber-500 bg-amber-50/50',
  conclusion: 'border-l-4 border-l-emerald-500 bg-emerald-50/50',
};

const SECTION_ICONS: Record<string, string> = {
  agenda: '📋',
  decision: '✅',
  risk: '⚠️',
  next_step: '🚀',
  conclusion: '📝',
};

const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-green-100 text-green-700 border-green-200',
};

export function SummaryActionSplit({
  summary,
  actionItems,
  onActionClick,
  onLinkAction,
}: SummaryActionSplitProps) {
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [showLinkModal, setShowLinkModal] = useState<number | null>(null);

  // Auto-link actions to sections based on content matching
  const linkedSummary = useMemo(() => {
    return summary.map((section, index) => {
      const relatedActions = actionItems
        .filter(action => {
          // Match by source sentence or content similarity
          if (action.source_sentence && section.content.includes(action.source_sentence)) {
            return true;
          }
          // Check if action description is mentioned in section
          if (section.content.toLowerCase().includes(action.description.toLowerCase().substring(0, 30))) {
            return true;
          }
          return false;
        })
        .map(action => action.id);
      
      return { ...section, relatedActions };
    });
  }, [summary, actionItems]);

  const toggleSection = (index: number) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedSections(newExpanded);
  };

  const getRelatedActions = (sectionIndex: number) => {
    const section = linkedSummary[sectionIndex];
    if (!section.relatedActions || section.relatedActions.length === 0) return [];
    return actionItems.filter(action => section.relatedActions?.includes(action.id));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700">摘要与行动项关联</h3>
        <span className="text-xs text-slate-500">
          共 {actionItems.length} 条行动项
        </span>
      </div>

      {linkedSummary.map((section, index) => {
        const relatedActions = getRelatedActions(index);
        const isExpanded = expandedSections.has(index);

        return (
          <div
            key={index}
            className={`rounded-lg border border-slate-200 overflow-hidden ${SECTION_COLORS[section.section_type]}`}
          >
            {/* Section Header */}
            <button
              onClick={() => toggleSection(index)}
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/50 transition-colors"
            >
              <span className="text-lg">{SECTION_ICONS[section.section_type]}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 line-clamp-2">
                  {section.content.substring(0, 100)}
                  {section.content.length > 100 ? '...' : ''}
                </p>
              </div>
              
              {/* Related Actions Badge */}
              {relatedActions.length > 0 && (
                <span className="flex items-center gap-1 text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                  <Link2 className="w-3 h-3" />
                  {relatedActions.length} 条关联
                </span>
              )}

              {section.confidence < 0.7 && (
                <span className="flex items-center gap-1 text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-full">
                  <AlertCircle className="w-3 h-3" />
                  低置信度
                </span>
              )}

              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {/* Expanded Content */}
            {isExpanded && (
              <div className="px-4 pb-4 border-t border-slate-100/50">
                <div className="pt-3">
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {section.content}
                  </p>
                </div>

                {/* Related Actions */}
                {relatedActions.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      相关行动项
                    </h4>
                    {relatedActions.map((action) => (
                      <div
                        key={action.id}
                        onClick={() => onActionClick?.(action.id)}
                        className="flex items-start gap-2 p-3 bg-white rounded-lg border border-slate-200 cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all"
                      >
                        <div className={`mt-0.5 w-2 h-2 rounded-full ${
                          action.status === 'done' ? 'bg-green-500' :
                          action.status === 'in_progress' ? 'bg-blue-500' :
                          action.status === 'blocked' ? 'bg-red-500' :
                          'bg-slate-300'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-800">{action.description}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            {action.assignee && (
                              <span className="text-xs text-slate-500">
                                👤 {action.assignee}
                              </span>
                            )}
                            {action.due_date && (
                              <span className="text-xs text-slate-500">
                                📅 {action.due_date}
                              </span>
                            )}
                            <span className={`text-xs px-1.5 py-0.5 rounded ${PRIORITY_COLORS[action.priority]}`}>
                              {action.priority === 'high' ? '高' : action.priority === 'medium' ? '中' : '低'}优先级
                            </span>
                          </div>
                        </div>
                        {action.status === 'done' && (
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Link New Action Button */}
                {onLinkAction && (
                  <button
                    onClick={() => setShowLinkModal(index)}
                    className="mt-3 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    关联新行动项
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Simple Link Modal */}
      {showLinkModal !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">关联行动项</h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {actionItems
                .filter(a => !linkedSummary[showLinkModal].relatedActions?.includes(a.id))
                .map(action => (
                  <button
                    key={action.id}
                    onClick={() => {
                      onLinkAction?.(showLinkModal, action.id);
                      setShowLinkModal(null);
                    }}
                    className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-all"
                  >
                    <p className="text-sm text-slate-800">{action.description}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {action.assignee || '未分配'} · {action.priority === 'high' ? '高' : action.priority === 'medium' ? '中' : '低'}优先级
                    </p>
                  </button>
                ))}
            </div>
            <button
              onClick={() => setShowLinkModal(null)}
              className="mt-4 w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
